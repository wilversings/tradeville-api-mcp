// Spawns the built MCP server (dist/index.js) as a real child process, talks to
// it over stdio with the MCP SDK's own client, and points it at a local mock of
// the Tradeville WebSocket API. Nothing is stubbed inside the server: every
// assertion goes through the actual MCP protocol and the actual server binary.

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

/**
 * Environment for the server child process. StdioClientTransport replaces the
 * environment wholesale, so anything the server genuinely needs has to be
 * forwarded explicitly — PATH to find `secret-tool`/`security`, APPDATA and
 * SystemRoot for the Windows DPAPI lookup, and the D-Bus address so a
 * `secret-tool` spawned from the child reaches the same keyring the test
 * session unlocked.
 */
function serverEnv(overrides) {
  const passthrough = [
    // Finding the helper binaries (secret-tool, security, powershell.exe).
    "PATH",
    "Path",
    "PATHEXT",
    // Windows: where DPAPI-encrypted files live, plus what PowerShell needs to
    // start at all under -NoProfile.
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "SYSTEMROOT",
    "windir",
    "COMSPEC",
    "PSModulePath",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "TEMP",
    "TMP",
    // macOS: resolving the user's keychain search list.
    "HOME",
    // Linux: reaching the same keyring the test session unlocked.
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
    "GNOME_KEYRING_CONTROL",
  ];

  const env = {};
  for (const key of passthrough) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...overrides };
}

/**
 * Starts a mock API + a server connected to it.
 *
 * @param {object} [options]
 * @param {string} [options.credentialService] Secret-store namespace the server
 *   reads. Defaults to the provisioned test namespace; pass an unprovisioned
 *   name to exercise the "credentials missing" path.
 * @param {boolean} [options.startMock] Set false to skip the mock entirely.
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
    // Surface server crashes in the test output instead of swallowing them.
    stderr: "inherit",
    env: serverEnv({
      TRADEVILLE_CREDENTIAL_SERVICE: credentialService,
      // A port nothing listens on when the mock is off, so an accidental live
      // connection attempt fails fast and loudly rather than reaching the
      // real API.
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
 * Calls a tool expecting it to fail, and returns the failure message.
 *
 * A failure reaches the caller one of two ways depending on where it came from:
 * the server's own handlers return `isError` results, while protocol-level
 * faults (unknown tool, schema validation) start as JSON-RPC errors, which the
 * SDK may either reject with or fold into an `isError` result. Both count as
 * failure here, so these tests assert on behaviour rather than on which of the
 * two shapes the SDK currently picks.
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
