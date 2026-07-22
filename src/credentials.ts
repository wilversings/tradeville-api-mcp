import { execFileSync } from "node:child_process";
import type { TradevilleConfig } from "./types.js";

const SERVICE = "tradeville-api-mcp";

const SETUP_HINT = `Tradeville credentials are not set up. Store them in the OS keyring with:
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
 * Resolves Tradeville credentials straight from the OS keyring (freedesktop
 * Secret Service / KWallet via `secret-tool`) so a real account's password
 * never needs to sit in an MCP client config file or an environment
 * variable. Throws if nothing (or only half of the pair) is stored; callers
 * should surface that lazily (e.g. on first tool call) rather than at
 * startup, since a crashed server before the MCP handshake completes just
 * shows a generic "Connection closed" with no detail.
 */
export function resolveCredentials(): TradevilleConfig {
  const user = secretToolLookup("user");
  const pass = secretToolLookup("pass");

  if (user && pass) return { user, pass, demo: false };

  throw new Error(SETUP_HINT);
}
