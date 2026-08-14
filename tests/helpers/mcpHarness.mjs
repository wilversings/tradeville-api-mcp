// Spawns the built server as a child process and drives it over stdio with the
// MCP SDK's own client, pointed at a local mock of the Tradeville API.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockTradeville } from "./mockTradeville.mjs";
import { TEST_SERVICE, TEST_USER, TEST_PASS } from "./testCredentials.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_ENTRY = path.join(REPO_ROOT, "dist", "index.js");

if (!existsSync(SERVER_ENTRY)) {
  throw new Error(`Missing ${SERVER_ENTRY}. Run "npm run build" before the integration tests.`);
}

// StdioClientTransport replaces the child's environment wholesale, so whatever
// the credential backends need must be forwarded by hand.
// Superset of the SDK's own DEFAULT_INHERITED_ENV_VARS: a thin Windows
// environment makes PowerShell startup pathologically slow, and the credential
// backend spawns it.
const PASSTHROUGH_ENV = [
  "PATH", "Path", "PATHEXT",
  "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "SYSTEMDRIVE",
  "windir", "COMSPEC", "PSModulePath", "PROCESSOR_ARCHITECTURE",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "ALLUSERSPROFILE",
  "USERNAME", "USERDOMAIN", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "TEMP", "TMP", "NUMBER_OF_PROCESSORS", "OS",
  "HOME",
  "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "GNOME_KEYRING_CONTROL",
];

function serverEnv(overrides) {
  const env = {};
  const seen = new Set();
  for (const key of PASSTHROUGH_ENV) {
    // Windows env lookups are case-insensitive, so PATH and Path both resolve;
    // emitting both would put duplicate keys in the child's environment block.
    const canonical = key.toLowerCase();
    if (seen.has(canonical) || process.env[key] === undefined) continue;
    seen.add(canonical);
    env[key] = process.env[key];
  }
  return { ...env, ...overrides };
}

/**
 * @param {object} [options]
 * @param {string} [options.credentialService] Secret-store namespace to read;
 *   pass an unprovisioned one to exercise the missing-credentials path.
 * @param {boolean} [options.startMock] Set false to run with no API at all.
 * @param {number} [options.responseDelayMs] Artificial mock latency.
 * @param {Record<string,string>} [options.env] Extra child-process env vars.
 */
export async function startHarness(options = {}) {
  const {
    credentialService = TEST_SERVICE,
    startMock = true,
    responseDelayMs = 0,
    env: extraEnv = {},
  } = options;

  const mock = startMock
    ? await startMockTradeville({ user: TEST_USER, pass: TEST_PASS, responseDelayMs })
    : null;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    cwd: REPO_ROOT,
    stderr: "inherit",
    env: serverEnv({
      TRADEVILLE_CREDENTIAL_SERVICE: credentialService,
      // Dead port without a mock, so a stray connection fails instead of
      // reaching the live API.
      TRADEVILLE_WS_URL: mock ? mock.url : "ws://127.0.0.1:1",
      ...extraEnv,
    }),
  });

  const client = new Client({ name: "tradeville-integration-tests", version: "1.0.0" });
  await client.connect(transport);

  return {
    client,
    mock,
    async close() {
      await client.close().catch(() => {});
      if (mock) await mock.close();
    },
  };
}

/** Calls a tool and asserts it did not come back as an MCP error result. */
export async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`tool ${name} returned an error: ${textOf(result)}`);
  }
  return result;
}

/**
 * Returns the failure message, whether the SDK rejected or folded the fault
 * into an `isError` result — it does the latter for protocol-level errors
 * today, but that is not a guarantee worth pinning tests to.
 */
export async function callToolExpectingError(client, name, args = {}) {
  let result;
  try {
    result = await client.callTool({ name, arguments: args });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (!result.isError) {
    throw new Error(`expected tool ${name} to fail, but it succeeded: ${textOf(result)}`);
  }
  return textOf(result);
}

/** Concatenated text content of a tool result. */
export function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Every tool result in this server is JSON in a single text block. */
export function jsonOf(result) {
  return JSON.parse(textOf(result));
}
