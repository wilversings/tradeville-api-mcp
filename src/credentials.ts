import { execFileSync } from "node:child_process";
import type { TradevilleConfig } from "./types.js";

const DEFAULT_SERVICE = "tradeville-api-mcp";

const IS_WINDOWS = process.platform === "win32";
const IS_MACOS = process.platform === "darwin";

/**
 * Namespace the credentials are stored under. Overridable so the integration
 * tests can use a throwaway namespace; it is a lookup key, never a secret.
 *
 * Resolved lazily, so a bad value surfaces as a tool-call error rather than
 * crashing the server before the MCP handshake completes. The charset is
 * restricted because the Windows backend splices this into a PowerShell script.
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

/**
 * Runs a credential-store lookup, retrying once.
 *
 * The retry is not defensive padding. `secret-tool` occasionally exits
 * non-zero with *empty stderr* when several lookups race for the Secret
 * Service — measured at roughly one failure in two hundred concurrent
 * lookups. Everything here treats a failed lookup as "no such credential", so
 * without the retry a transient bus hiccup tells the user their credentials
 * are not set up and asks them to store credentials that are already stored.
 * One retry, not a loop: a store that is genuinely absent should answer
 * immediately, not after a backoff.
 */
function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value = execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        ...(env ? { env } : {}),
      }).trim();
      return value || null;
    } catch {
      // Fall through to the retry; a second failure means genuinely absent.
    }
  }
  return null;
}

/**
 * Windows PowerShell cannot autoload its own core modules when it inherits a
 * PSModulePath from PowerShell 7 (which happens whenever the MCP client was
 * launched from pwsh), so pin it to the 5.1 system module directory.
 */
function powershellEnv(): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
  return {
    ...process.env,
    PSModulePath: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules`,
  };
}

function secretToolLookup(service: string, key: string): string | null {
  return run("secret-tool", ["lookup", "service", service, "key", key]);
}

/** Searches the user's keychain search list, not just the login keychain. */
function keychainLookup(service: string, key: string): string | null {
  return run("security", ["find-generic-password", "-s", service, "-a", key, "-w"]);
}

/**
 * `key` is our own literal and `service` is charset-validated, so splicing them
 * in is safe. -EncodedCommand (base64 UTF-16LE) sidesteps cmd/PowerShell
 * quoting entirely.
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
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    powershellEnv()
  );
}

/**
 * Reads the credentials from the OS secret store — Secret Service via
 * `secret-tool` on Linux, the keychain via `security` on macOS, DPAPI via
 * PowerShell on Windows — so a real password never sits in an MCP client config
 * file or an environment variable.
 *
 * Throws if nothing (or only half the pair) is stored. Callers should surface
 * that lazily, on first tool call: crashing before the MCP handshake completes
 * shows the user only a generic "Connection closed".
 */
export function resolveCredentials(): TradevilleConfig {
  const service = resolveService();
  const lookup = IS_WINDOWS ? dpapiLookup : IS_MACOS ? keychainLookup : secretToolLookup;
  const user = lookup(service, "user");
  const pass = lookup(service, "pass");

  if (user && pass) return { user, pass, demo: false };

  throw new Error(setupHint(service));
}
