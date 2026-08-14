// Every API-backed tool, end to end: MCP call -> command + params on the wire
// -> columnar response -> row objects. Both directions matter: a wrong `prm`
// asks the API the wrong question, a wrong shape hands the model an unreadable
// table.

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { callTool, jsonOf, startHarness } from "./helpers/mcpHarness.mjs";
import { FIXTURES } from "./helpers/mockTradeville.mjs";

const CASES = [
  {
    tool: "get_portfolio",
    args: {},
    cmd: "Portfolio",
    prm: { data: null },
    describe: "defaults to the current portfolio when no date is given",
  },
  {
    tool: "get_portfolio",
    args: { date: "1oct20" },
    cmd: "Portfolio",
    prm: { data: "1oct20" },
    describe: "passes a historical date straight through",
  },
  {
    tool: "get_portfolio",
    args: { date: null },
    cmd: "Portfolio",
    prm: { data: null },
    describe: "treats an explicit null date as 'current'",
  },
  {
    tool: "search_symbol",
    args: { search: "BRD" },
    cmd: "SearchSymbol",
    prm: { search: "BRD" },
  },
  {
    tool: "get_symbol",
    args: { symbol: "BRD" },
    cmd: "Symbol",
    prm: { symbol: "BRD" },
  },
  {
    tool: "get_market_depth",
    args: { symbol: "BRD" },
    cmd: "Level2",
    prm: { symbol: "BRD" },
    describe: "omits `levels` entirely when it was not requested",
  },
  {
    tool: "get_market_depth",
    args: { symbol: "BRD", levels: 5 },
    cmd: "Level2",
    prm: { symbol: "BRD", levels: 5 },
  },
  {
    tool: "get_daily_values",
    args: { symbol: "BRD", dstart: "2024-01-03", dend: "2024-01-05" },
    cmd: "DailyValues",
    prm: { symbol: "BRD", dstart: "2024-01-03", dend: "2024-01-05" },
  },
  {
    tool: "get_daily_values",
    args: { dstart: "2024-01-05", dend: "2024-01-05" },
    cmd: "DailyValues",
    prm: { symbol: null, dstart: "2024-01-05", dend: "2024-01-05" },
    describe: "sends a null symbol for the all-symbols single-day form",
  },
  {
    tool: "get_daily_values",
    args: { symbol: "BRD", dstart: "1oct20", dend: "1nov20", adj: 1 },
    cmd: "DailyValues",
    prm: { symbol: "BRD", dstart: "1oct20", dend: "1nov20", adj: 1 },
    describe: "forwards the split-adjustment flag",
  },
  {
    tool: "get_trades",
    args: { symbol: "BRD", dstart: "2024-01-05", dend: "2024-01-05" },
    cmd: "Trades",
    prm: { symbol: "BRD", dstart: "2024-01-05", dend: "2024-01-05" },
  },
  {
    tool: "get_activity",
    args: { dstart: "2024-01-01", dend: "2024-01-31" },
    cmd: "Activity",
    prm: { symbol: null, dstart: "2024-01-01", dend: "2024-01-31" },
    describe: "covers all symbols when none is given",
  },
  {
    tool: "get_orders",
    args: { symbol: "BRD" },
    cmd: "Orders",
    prm: { symbol: "BRD", dstart: null },
    describe: "sends a null start date when unfiltered",
  },
  {
    tool: "get_orders",
    args: { symbol: "BRD", dstart: "2024-01-01" },
    cmd: "Orders",
    prm: { symbol: "BRD", dstart: "2024-01-01" },
  },
  {
    tool: "get_fx_rates",
    args: { ccy: "EUR", dstart: "2024-01-03", dend: "2024-01-05" },
    cmd: "FXBNR",
    prm: { ccy: "EUR", dstart: "2024-01-03", dend: "2024-01-05" },
  },
  {
    tool: "get_fx_rates",
    args: { dstart: "2024-01-03", dend: "2024-01-05" },
    cmd: "FXBNR",
    prm: { ccy: null, dstart: "2024-01-03", dend: "2024-01-05" },
    describe: "requests all currencies when none is given",
  },
];

describe("API-backed tools", () => {
  let harness;

  before(async () => {
    harness = await startHarness();
  });

  after(async () => {
    await harness?.close();
  });

  test("logs in before the first request, exactly once", async () => {
    await callTool(harness.client, "get_symbol", { symbol: "BRD" });
    await callTool(harness.client, "get_symbol", { symbol: "TLV" });

    assert.equal(harness.mock.requestsFor("login").length, 1);
    assert.equal(harness.mock.commands[0], "login", "login must precede any command");
    assert.equal(harness.mock.connectionCount, 1, "should reuse a single connection");
  });

  for (const testCase of CASES) {
    const label = testCase.describe
      ? `${testCase.tool} ${testCase.describe}`
      : `${testCase.tool} maps to ${testCase.cmd}`;

    test(label, async () => {
      const before = harness.mock.requestsFor(testCase.cmd).length;
      const result = await callTool(harness.client, testCase.tool, testCase.args);

      const sent = harness.mock.requestsFor(testCase.cmd);
      assert.equal(sent.length, before + 1, `expected one new ${testCase.cmd} request`);
      assert.deepEqual(sent.at(-1).prm, testCase.prm, "params sent to the API");

      const rows = jsonOf(result);
      assert.ok(Array.isArray(rows), "tabular results should transpose into an array of rows");

      const fixture = FIXTURES[testCase.cmd];
      const columns = Object.keys(fixture);
      assert.equal(rows.length, fixture[columns[0]].length, "row count");
      assert.deepEqual(Object.keys(rows[0]).sort(), [...columns].sort(), "row keys");

      for (const column of columns) {
        const expected = fixture[column];
        // The mock rewrites Symbol to echo the request; skip it there.
        if (column === "Symbol" && typeof testCase.args.symbol === "string") continue;
        assert.deepEqual(
          rows.map((row) => row[column]),
          expected,
          `column ${column} did not survive transposition`
        );
      }
    });
  }

  test("returns the symbol that was actually requested", async () => {
    const rows = jsonOf(await callTool(harness.client, "get_symbol", { symbol: "SNP" }));
    assert.deepEqual([...new Set(rows.map((row) => row.Symbol))], ["SNP"]);
  });
});
