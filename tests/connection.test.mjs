// WebSocket client invariants underneath the tools: request serialization,
// transparent reconnect, and the two response envelope shapes.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { callTool, jsonOf, startHarness } from "./helpers/mcpHarness.mjs";

describe("connection handling", () => {
  test("negotiates the apitv subprotocol", async () => {
    const harness = await startHarness();
    try {
      await callTool(harness.client, "get_symbol", { symbol: "BRD" });
      assert.equal(harness.mock.connectionCount, 1);
      assert.equal(harness.mock.rejectedProtocol, false, "client offered the wrong subprotocol");
    } finally {
      await harness.close();
    }
  });

  test("serializes concurrent tool calls, one request in flight at a time", async () => {
    // Responses correlate positionally, not by id, so overlap would hand each
    // caller someone else's data.
    const harness = await startHarness({ responseDelayMs: 25 });
    try {
      const symbols = ["BRD", "TLV", "SNP", "FP", "EL"];
      const results = await Promise.all(
        symbols.map((symbol) => callTool(harness.client, "get_symbol", { symbol }))
      );

      assert.equal(harness.mock.maxInFlight, 1, "requests overlapped on the wire");

      // Each caller must get back the symbol it asked for, in its own result.
      results.forEach((result, i) => {
        const rows = jsonOf(result);
        assert.deepEqual(
          [...new Set(rows.map((row) => row.Symbol))],
          [symbols[i]],
          `call for ${symbols[i]} received the wrong response`
        );
      });
    } finally {
      await harness.close();
    }
  });

  test("reconnects and logs in again after the API drops the connection", async () => {
    const harness = await startHarness();
    try {
      await callTool(harness.client, "get_symbol", { symbol: "BRD" });
      assert.equal(harness.mock.connectionCount, 1);

      harness.mock.dropConnections();
      await new Promise((resolve) => setTimeout(resolve, 250)); // let close propagate

      const rows = jsonOf(await callTool(harness.client, "get_symbol", { symbol: "TLV" }));
      assert.deepEqual([...new Set(rows.map((row) => row.Symbol))], ["TLV"]);

      assert.equal(harness.mock.connectionCount, 2, "should have dialled again");
      assert.equal(harness.mock.requestsFor("login").length, 2, "should log in again");
    } finally {
      await harness.close();
    }
  });

  test("fails an in-flight request when the connection drops under it", async () => {
    const harness = await startHarness();
    try {
      await callTool(harness.client, "get_symbol", { symbol: "BRD" });

      // Swallow the request so it is still pending when the socket dies.
      harness.mock.setResponse("Portfolio", () => null);
      const pending = harness.client.callTool({ name: "get_portfolio", arguments: {} });
      await new Promise((resolve) => setTimeout(resolve, 150));
      harness.mock.dropConnections();

      const result = await pending;
      assert.ok(result.isError, "a dropped request must not resolve as success");
    } finally {
      await harness.close();
    }
  });
});

describe("response envelope shapes", () => {
  test("transposes tabular data nested under `data`", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Symbol", {
        cmd: "Symbol",
        prm: {},
        data: { Symbol: ["BRD", "TLV"], Price: [19.86, 26.1] },
      });

      const rows = jsonOf(await callTool(harness.client, "get_symbol", { symbol: "BRD" }));
      assert.deepEqual(rows, [
        { Symbol: "BRD", Price: 19.86 },
        { Symbol: "TLV", Price: 26.1 },
      ]);
    } finally {
      await harness.close();
    }
  });

  test("transposes tabular data sent at the top level", async () => {
    // The shape the upstream docs show; the live API uses `data`. Both work.
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Symbol", {
        cmd: "Symbol",
        Symbol: ["BRD"],
        Price: [19.86],
      });

      const rows = jsonOf(await callTool(harness.client, "get_symbol", { symbol: "BRD" }));
      assert.deepEqual(rows, [{ Symbol: "BRD", Price: 19.86 }]);
    } finally {
      await harness.close();
    }
  });

  test("passes a non-tabular acknowledgement through unchanged", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Symbol", { cmd: "Symbol", prm: {}, OK: 1 });

      const payload = jsonOf(await callTool(harness.client, "get_symbol", { symbol: "BRD" }));
      assert.deepEqual(payload, { OK: 1 }, "cmd/prm envelope should be stripped");
    } finally {
      await harness.close();
    }
  });

  test("leaves ragged columns alone rather than inventing rows", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Symbol", {
        cmd: "Symbol",
        data: { Symbol: ["BRD", "TLV"], Price: [19.86] },
      });

      const payload = jsonOf(await callTool(harness.client, "get_symbol", { symbol: "BRD" }));
      assert.deepEqual(payload, { Symbol: ["BRD", "TLV"], Price: [19.86] });
    } finally {
      await harness.close();
    }
  });

  test("returns an empty table as an empty array of rows", async () => {
    const harness = await startHarness();
    try {
      harness.mock.setResponse("Portfolio", {
        cmd: "Portfolio",
        data: { Symbol: [], Quantity: [] },
      });

      const rows = jsonOf(await callTool(harness.client, "get_portfolio", {}));
      assert.deepEqual(rows, []);
    } finally {
      await harness.close();
    }
  });
});
