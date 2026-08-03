import { execFileSync } from "node:child_process";
import type { TradevilleConfig } from "./types.js";

const SERVICE = "tradeville-api-mcp";
const IS_WINDOWS = process.platform === "win32";

const SETUP_HINT = IS_WINDOWS
  ? `Tradeville credentials are not set up. Store them (DPAPI-encrypted, tied to your Windows user account) with PowerShell:
  $dir = "$env:APPDATA\\tradeville-api-mcp"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Read-Host -AsSecureString "Tradeville user" | ConvertFrom-SecureString | Set-Content "$dir\\user.dat"
  Read-Host -AsSecureString "Tradeville password" | ConvertFrom-SecureString | Set-Content "$dir\\pass.dat"
then reconnect this MCP server (e.g. restart Claude Code, or use /mcp to reconnect).`
  : `Tradeville credentials are not set up. Store them in the OS keyring with:
  secret-tool store --label 'Tradeville API user' service tradeville-api-mcp key user
  secret-tool store --label 'Tradeville API password' service tradeville-api-mcp key pass
then reconnect this MCP server (e.g. restart Claude Code, or use /mcp to reconnect).`;

function secretToolLookup(key: string): string | null {
  try {
    const value = execFileSync("secret-tool", ["lookup", "service", SERVICE, "key", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * `key` is always our own "user"/"pass" literal, never external input, so
 * splicing it into the script is safe. The script itself travels via
 * -EncodedCommand (base64 UTF-16LE) rather than -Command to sidestep
 * cmd/PowerShell quoting entirely.
 */
function dpapiLookup(key: "user" | "pass"): string | null {
  const script = `
$ErrorActionPreference = 'Stop'
$path = Join-Path $env:APPDATA 'tradeville-api-mcp\\${key}.dat'
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
  try {
    const value = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Resolves Tradeville credentials straight from the OS secret store —
 * freedesktop Secret Service / KWallet via `secret-tool` on Linux, DPAPI
 * (via PowerShell) on Windows — so a real account's password never needs to
 * sit in an MCP client config file or an environment variable. Throws if
 * nothing (or only half of the pair) is stored; callers should surface that
 * lazily (e.g. on first tool call) rather than at startup, since a crashed
 * server before the MCP handshake completes just shows a generic
 * "Connection closed" with no detail.
 */
export function resolveCredentials(): TradevilleConfig {
  const lookup = IS_WINDOWS ? dpapiLookup : secretToolLookup;
  const user = lookup("user");
  const pass = lookup("pass");

  if (user && pass) return { user, pass, demo: false };

  throw new Error(SETUP_HINT);
}
