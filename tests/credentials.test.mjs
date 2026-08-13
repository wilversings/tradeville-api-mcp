// The one part of this server that is genuinely different on every platform:
// reading the username and password out of the OS secret store (secret-tool on
// Linux, the keychain on macOS, DPAPI on Windows).
//
// These tests assert on what the server actually put on the wire, so they only
// pass if the real per-platform backend read the real stored values back.
// scripts/setup-test-credentials.mjs provisions them first.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { callTool, callToolExpectingError, startHarness } from "./helpers/mcpHarness.mjs";
import { TEST_PASS, TEST_USER, UNCONFIGURED_SERVICE } from "./helpers/testCredentials.mjs";

describe("credentials from the OS secret store", () => {
  test("logs in with the credentials stored for this platform", async () => {
    const harness = await startHarness();
    try {
      await callTool(harness.client, "get_portfolio", {});

      const login = harness.mock.onlyRequestFor("login");
      assert.equal(login.prm.coduser, TEST_USER, "username did not come from the secret store");
      assert.equal(login.prm.parola, TEST_PASS, "password did not come from the secret store");
      assert.equal(typeof login.prm.demo, "boolean");
    } finally {
      await harness.close();
    }
  });

  test("explains how to store credentials when none are configured", async () => {
    const harness = await startHarness({ credentialService: UNCONFIGURED_SERVICE });
    try {
      const message = await callToolExpectingError(harness.client, "get_portfolio", {});

      assert.match(message, /credentials are not set up/i);
      assert.match(message, new RegExp(UNCONFIGURED_SERVICE));

      // The hint has to name the right tool for the platform it is running on.
      const expected =
        process.platform === "win32"
          ? /ConvertFrom-SecureString/
          : process.platform === "darwin"
            ? /security add-generic-password/
            : /secret-tool store/;
      assert.match(message, expected);
    } finally {
      await harness.close();
    }
  });

  test("does not open a connection when credentials are missing", async () => {
    const harness = await startHarness({ credentialService: UNCONFIGURED_SERVICE });
    try {
      await callToolExpectingError(harness.client, "get_portfolio", {});
      assert.equal(harness.mock.connectionCount, 0, "should not dial the API without credentials");
    } finally {
      await harness.close();
    }
  });

  test("still serves tools that need no credentials", async () => {
    const harness = await startHarness({ credentialService: UNCONFIGURED_SERVICE });
    try {
      const result = await callTool(harness.client, "get_stock_screen", { symbols: [] });
      assert.ok(result.content.length > 0);
    } finally {
      await harness.close();
    }
  });

  test("reports the missing-credentials hint on every attempt, not just the first", async () => {
    const harness = await startHarness({ credentialService: UNCONFIGURED_SERVICE });
    try {
      const first = await callToolExpectingError(harness.client, "get_portfolio", {});
      const second = await callToolExpectingError(harness.client, "get_symbol", { symbol: "BRD" });
      assert.equal(first, second);
    } finally {
      await harness.close();
    }
  });

  test("rejects a credential namespace that could escape into a shell", async () => {
    // The Windows backend splices this name into a PowerShell script.
    const harness = await startHarness({ credentialService: "bad name; rm -rf" });
    try {
      const message = await callToolExpectingError(harness.client, "get_portfolio", {});
      assert.match(message, /Invalid TRADEVILLE_CREDENTIAL_SERVICE/);
      assert.equal(harness.mock.connectionCount, 0);
    } finally {
      await harness.close();
    }
  });

  test("never echoes the password into a tool result", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("login", { cmd: "login", err: "user sau parola gresite" });
      const message = await callToolExpectingError(harness.client, "get_portfolio", {});
      assert.ok(!message.includes(TEST_PASS), "error message leaked the stored password");
    } finally {
      await harness.close();
    }
  });
});
