// Failure paths. The server is expected to turn every one of these into a
// readable MCP error rather than hanging, crashing, or returning a result that
// looks successful.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { callTool, callToolExpectingError, startHarness } from "./helpers/mcpHarness.mjs";

describe("API errors", () => {
  test("surfaces an API `err` payload as an MCP error result", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Symbol", { cmd: "Symbol", err: "simbol inexistent" });

      const message = await callToolExpectingError(harness.client, "get_symbol", {
        symbol: "NOPE",
      });
      assert.match(message, /simbol inexistent/);
    } finally {
      await harness.close();
    }
  });

  test("keeps serving after a tool call fails", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Symbol", { cmd: "Symbol", err: "temporar indisponibil" });
      await callToolExpectingError(harness.client, "get_symbol", { symbol: "BRD" });

      // A different tool must still work on the same connection.
      const ok = await callTool(harness.client, "get_fx_rates", {
        dstart: "2024-01-03",
        dend: "2024-01-05",
      });
      assert.ok(ok.content.length > 0);
    } finally {
      await harness.close();
    }
  });

  test("reports a failed login instead of returning empty data", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("login", { cmd: "login", err: "user sau parola gresite" });

      const message = await callToolExpectingError(harness.client, "get_portfolio", {});
      assert.match(message, /user sau parola gresite/);
    } finally {
      await harness.close();
    }
  });

  test("fails cleanly when the API is unreachable", async () => {
    const harness = await startHarness({ startMock: false });
    try {
      const message = await callToolExpectingError(harness.client, "get_portfolio", {});
      assert.ok(message.length > 0, "expected an explanatory error message");
      assert.doesNotMatch(message, /^\s*$/);
    } finally {
      await harness.close();
    }
  });
});

describe("argument validation", () => {
  test("rejects a call missing a required argument", async () => {
    const harness = await startHarness();
    try {
      const message = await callToolExpectingError(harness.client, "get_symbol", {});
      assert.match(message, /invalid arguments|validation/i);
      assert.match(message, /symbol/, "should say which argument was wrong");
    } finally {
      await harness.close();
    }
  });

  test("rejects an argument of the wrong type", async () => {
    const harness = await startHarness();
    try {
      const numeric = await callToolExpectingError(harness.client, "get_market_depth", {
        symbol: "BRD",
        levels: "five",
      });
      assert.match(numeric, /invalid arguments|validation/i);

      const array = await callToolExpectingError(harness.client, "get_stock_screen", {
        symbols: "BRD",
      });
      assert.match(array, /invalid arguments|validation/i);
    } finally {
      await harness.close();
    }
  });

  test("never forwards a rejected call to the API", async () => {
    const harness = await startHarness();
    try {
      await callToolExpectingError(harness.client, "get_symbol", {});
      assert.deepEqual(harness.mock.requestsFor("Symbol"), []);
    } finally {
      await harness.close();
    }
  });
});

