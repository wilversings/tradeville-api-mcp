#!/usr/bin/env node
// Provisions the integration tests' fixture credentials into the native OS
// secret store, using the same backend src/credentials.ts reads from:
//
//   Linux    freedesktop Secret Service, via `secret-tool`
//   macOS    a dedicated keychain on the user's search list, via `security`
//   Windows  DPAPI-encrypted files under %APPDATA%, via PowerShell
//
// It writes under the "tradeville-api-mcp-test" namespace, never the real
// "tradeville-api-mcp" one, so running it cannot clobber your own credentials.
//
// It reads the values back afterwards, so a locked or unavailable secret store
// fails here with a clear message instead of deep inside a spawned server.
//
// Usage: node scripts/setup-test-credentials.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  TEST_SERVICE,
  TEST_USER,
  TEST_PASS,
} from "../tests/helpers/testCredentials.mjs";

const IS_WINDOWS = process.platform === "win32";
const IS_MACOS = process.platform === "darwin";

// Dedicated keychain rather than the login one: CI runners do not hand out the
// login keychain password, and this keeps test fixtures out of a developer's
// personal keychain.
const MACOS_KEYCHAIN = "tradeville-test.keychain-db";
const MACOS_KEYCHAIN_PASSWORD = "tradeville-test";

function fail(message, detail) {
  console.error(`setup-test-credentials: ${message}`);
  if (detail) console.error(detail.trim());
  process.exit(1);
}

function run(command, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  if (result.error) {
    if (allowFailure) return result;
    fail(`failed to run \`${command}\``, result.error.message);
  }
  if (!allowFailure && result.status !== 0) {
    fail(`\`${command} ${args.join(" ")}\` exited with ${result.status}`, result.stderr);
  }
  return result;
}

function setupLinux() {
  // secret-tool has no --version; a bare invocation prints usage and exits 0,
  // so spawn failure (ENOENT) is what actually tells us it is missing.
  const check = run("secret-tool", [], { allowFailure: true });
  if (check.error) {
    fail(
      "`secret-tool` is not available. Install libsecret-tools (Debian/Ubuntu) " +
        "or libsecret (Fedora/Arch), and make sure a Secret Service provider " +
        "(GNOME Keyring, KWallet) is running and unlocked."
    );
  }

  for (const [key, value] of [
    ["user", TEST_USER],
    ["pass", TEST_PASS],
  ]) {
    run("secret-tool", ["store", "--label", `Tradeville test ${key}`, "service", TEST_SERVICE, "key", key], {
      input: value,
    });
  }
}

function setupMacos() {
  const keychains = run("security", ["list-keychains", "-d", "user"]).stdout;
  const existing = [...keychains.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  // create-keychain fails if it already exists, which is fine on a re-run.
  run("security", ["create-keychain", "-p", MACOS_KEYCHAIN_PASSWORD, MACOS_KEYCHAIN], {
    allowFailure: true,
  });
  // No auto-lock: an idle-locked keychain would make lookups fail mid-run.
  run("security", ["set-keychain-settings", MACOS_KEYCHAIN]);
  run("security", ["unlock-keychain", "-p", MACOS_KEYCHAIN_PASSWORD, MACOS_KEYCHAIN]);

  if (!existing.some((entry) => entry.includes("tradeville-test"))) {
    run("security", ["list-keychains", "-d", "user", "-s", MACOS_KEYCHAIN, ...existing]);
  }

  for (const [key, value] of [
    ["user", TEST_USER],
    ["pass", TEST_PASS],
  ]) {
    // -U updates an existing item instead of erroring; -A skips the ACL prompt,
    // which would otherwise block on a headless CI runner.
    run("security", [
      "add-generic-password",
      "-U",
      "-A",
      "-s",
      TEST_SERVICE,
      "-a",
      key,
      "-w",
      value,
      MACOS_KEYCHAIN,
    ]);
  }
}

function setupWindows() {
  const appData = process.env.APPDATA;
  if (!appData) fail("APPDATA is not set; cannot locate the credential directory.");

  const dir = path.join(appData, TEST_SERVICE);
  mkdirSync(dir, { recursive: true });

  for (const [key, value] of [
    ["user", TEST_USER],
    ["pass", TEST_PASS],
  ]) {
    // Same DPAPI format the README's Read-Host recipe produces, just written
    // non-interactively. The value travels via an env var rather than being
    // spliced into the script text.
    const script = `
$ErrorActionPreference = 'Stop'
$path = Join-Path $env:APPDATA '${TEST_SERVICE}\\${key}.dat'
ConvertTo-SecureString -String $env:TDV_TEST_VALUE -AsPlainText -Force |
  ConvertFrom-SecureString | Set-Content -Path $path
`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { encoding: "utf8", env: { ...process.env, TDV_TEST_VALUE: value } }
    );
    if (result.status !== 0) {
      fail(`failed to store the ${key} credential via DPAPI`, result.stderr || result.stdout);
    }
  }
}

/**
 * Reads the credentials straight back out, issuing the same lookup commands
 * src/credentials.ts does. This turns a locked or missing secret store into a
 * clear failure here, rather than an opaque one inside a spawned MCP server.
 */
function verify() {
  const lookup = IS_WINDOWS ? readWindows : IS_MACOS ? readMacos : readLinux;
  const user = lookup("user");
  const pass = lookup("pass");

  if (user !== TEST_USER || pass !== TEST_PASS) {
    fail(
      "stored credentials did not read back correctly " +
        `(got user=${JSON.stringify(user)}, pass=${pass ? "<set>" : "<empty>"}). ` +
        "The secret store is probably locked or unavailable."
    );
  }
  console.log(`setup-test-credentials: OK (${process.platform}, service "${TEST_SERVICE}")`);
}

function readLinux(key) {
  return tryRead("secret-tool", ["lookup", "service", TEST_SERVICE, "key", key]);
}

function readMacos(key) {
  return tryRead("security", ["find-generic-password", "-s", TEST_SERVICE, "-a", key, "-w"]);
}

function readWindows(key) {
  const script = `
$ErrorActionPreference = 'Stop'
$path = Join-Path $env:APPDATA '${TEST_SERVICE}\\${key}.dat'
if (-not (Test-Path $path)) { exit 0 }
$secure = Get-Content $path | ConvertTo-SecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return tryRead("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
}

function tryRead(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

if (IS_WINDOWS) setupWindows();
else if (IS_MACOS) setupMacos();
else setupLinux();

verify();
