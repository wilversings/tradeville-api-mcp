import { execFileSync } from "node:child_process";
import type { TradevilleConfig } from "./types.js";

const DEFAULT_SERVICE = "tradeville-api-mcp";

const IS_WINDOWS = process.platform === "win32";
const IS_MACOS = process.platform === "darwin";

/**
 * Namespace the credentials are stored under (secret-service attribute on
 * Linux, keychain service on macOS, `%APPDATA%` subdirectory on Windows).
 * Overridable so the integration tests can use a throwaway namespace instead of
 * clobbering a developer's real stored credentials. It is a lookup key, never a
 * secret — the password itself is still only ever read from the OS secret store.
 *
 * The Windows backend splices this into a PowerShell script, so it must not be
 * arbitrary shell text; a conservative identifier charset keeps that safe. This
 * is resolved lazily (not at module load) so a bad value surfaces as a tool-call
 * error rather than crashing the server before the MCP handshake completes.
 */
function resolveService(): string {
  const override = process.env.TRADEVILLE_CREDENTIAL_SERVICE?.trim();
  if (!override) return DEFAULT_SERVICE;
  if (!/^[A-Za-z0-9._-]+$/.test(override)) {
    throw new Error(
      `Invalid TRADEVILLE_CREDENTIAL_SERVICE ${JSON.stringify(override)}: ` +
        "only letters, digits, dot, underscore and hyphen are allowed."
    );
  }
  return override;
}

function setupHint(service: string): string {
  if (IS_WINDOWS) {
    return `Tradeville credentials are not set up. Store them (DPAPI-encrypted, tied to your Windows user account) with PowerShell:
  $dir = "$env:APPDATA\\${service}"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Read-Host -AsSecureString "Tradeville user" | ConvertFrom-SecureString | Set-Content "$dir\\user.dat"
  Read-Host -AsSecureString "Tradeville password" | ConvertFrom-SecureString | Set-Content "$dir\\pass.dat"
then reconnect this MCP server (e.g. restart Claude Code, or use /mcp to reconnect).`;
  }
  if (IS_MACOS) {
    return `Tradeville credentials are not set up. Store them in your login keychain with:
  security add-generic-password -U -s ${service} -a user -w
  security add-generic-password -U -s ${service} -a pass -w
(each prompts for the value, so it stays out of your shell history)
then reconnect this MCP server (e.g. restart Claude Code, or use /mcp to reconnect).`;
  }
  return `Tradeville credentials are not set up. Store them in the OS keyring with:
  secret-tool store --label 'Tradeville API user' service ${service} key user
  secret-tool store --label 'Tradeville API password' service ${service} key pass
then reconnect this MCP server (e.g. restart Claude Code, or use /mcp to reconnect).`;
}

function run(command: string, args: string[]): string | null {
  try {
    const value = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Linux: freedesktop Secret Service / KWallet, via `secret-tool`. */
function secretToolLookup(service: string, key: string): string | null {
  return run("secret-tool", ["lookup", "service", service, "key", key]);
}

/**
 * macOS: the keychain, via `security` (`-w` prints only the password). Lookups
 * go through the user's keychain search list, so an item in any keychain on
 * that list resolves, not just the login one.
 */
function keychainLookup(service: string, key: string): string | null {
  return run("security", ["find-generic-password", "-s", service, "-a", key, "-w"]);
}

/**
 * `key` is always our own "user"/"pass" literal and `service` is validated
 * against a conservative charset in `resolveService`, so splicing them into the
 * script is safe. The script itself travels via -EncodedCommand (base64
 * UTF-16LE) rather than -Command to sidestep cmd/PowerShell quoting entirely.
 */
function dpapiLookup(service: string, key: "user" | "pass"): string | null {
  const script = `
$ErrorActionPreference = 'Stop'
$path = Join-Path $env:APPDATA '${service}\\${key}.dat'
if (-not (Test-Path $path)) { exit 0 }
$secure = Get-Content $path | ConvertTo-SecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
}

/**
 * Resolves Tradeville credentials straight from the OS secret store —
 * freedesktop Secret Service / KWallet via `secret-tool` on Linux, the keychain
 * via `security` on macOS, DPAPI (via PowerShell) on Windows — so a real
 * account's password never needs to sit in an MCP client config file or an
 * environment variable. Throws if nothing (or only half of the pair) is stored;
 * callers should surface that lazily (e.g. on first tool call) rather than at
 * startup, since a crashed server before the MCP handshake completes just shows
 * a generic "Connection closed" with no detail.
 */
export function resolveCredentials(): TradevilleConfig {
  const service = resolveService();
  const lookup = IS_WINDOWS ? dpapiLookup : IS_MACOS ? keychainLookup : secretToolLookup;
  const user = lookup(service, "user");
  const pass = lookup(service, "pass");

  if (user && pass) return { user, pass, demo: false };

  throw new Error(setupHint(service));
}
