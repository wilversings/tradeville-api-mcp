#!/usr/bin/env node
// Breaks the cost of one harness down into its stages, to locate slowness that
// only shows up on a CI runner. Diagnostic only; nothing depends on it.
//
// Usage: node scripts/diagnose-timings.mjs

import { execFileSync } from "node:child_process";
import { startHarness, callTool } from "../tests/helpers/mcpHarness.mjs";
import { startMockTradeville } from "../tests/helpers/mockTradeville.mjs";
import { TEST_SERVICE, TEST_USER, TEST_PASS } from "../tests/helpers/testCredentials.mjs";

const IS_WINDOWS = process.platform === "win32";

async function time(label, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`${(performance.now() - start).toFixed(0).padStart(8)} ms  ${label}`);
  }
}

function credentialLookupArgs() {
  if (IS_WINDOWS) {
    const script = `
$path = Join-Path $env:APPDATA '${TEST_SERVICE}\\user.dat'
$secure = Get-Content $path | ConvertTo-SecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]];
  }
  if (process.platform === "darwin") {
    return ["security", ["find-generic-password", "-s", TEST_SERVICE, "-a", "user", "-w"]];
  }
  return ["secret-tool", ["lookup", "service", TEST_SERVICE, "key", "user"]];
}

const [command, args] = credentialLookupArgs();

const psModulePath = IS_WINDOWS
  ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\Modules`
  : undefined;

function lookup(env) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      ...(env ? { env } : {}),
    }).trim();
  } catch (err) {
    return `<failed: ${err.message.split("\n")[0]}>`;
  }
}

console.log(`platform ${process.platform}, node ${process.version}\n`);

await time("credential lookup, inherited env", () => lookup(undefined));
await time("credential lookup, inherited env (2nd)", () => lookup(undefined));

if (IS_WINDOWS) {
  await time("credential lookup, pinned PSModulePath", () =>
    lookup({ ...process.env, PSModulePath: psModulePath })
  );
  await time("credential lookup, minimal env", () =>
    lookup({
      SystemRoot: process.env.SystemRoot,
      Path: process.env.Path,
      APPDATA: process.env.APPDATA,
      PSModulePath: psModulePath,
    })
  );
}

const mock = await time("start mock server", () =>
  startMockTradeville({ user: TEST_USER, pass: TEST_PASS })
);
await mock.close();

const harness = await time("spawn server + MCP handshake", () => startHarness());
await time("first tool call (credentials + connect + login)", () =>
  callTool(harness.client, "get_symbol", { symbol: "BRD" })
);
await time("second tool call (warm)", () =>
  callTool(harness.client, "get_symbol", { symbol: "TLV" })
);
await time("close harness", () => harness.close());

const second = await time("spawn a second harness end to end", async () => {
  const h = await startHarness();
  await callTool(h.client, "get_portfolio", {});
  return h;
});
await second.close();
