// The one tool backed by the bundled CSV rather than the API, so it must work
// with the API unreachable. Its path is resolved relative to the built bundle,
// which is the kind of thing that breaks on a different path separator.

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { callTool, jsonOf, startHarness } from "./helpers/mcpHarness.mjs";

/** Columns the tool description promises. */
const EXPECTED_COLUMNS = [
  "Simbol", "Cotatie", "Capitalizare", "MedieZilnicaTranz", "VarYoY", "VarYTD",
  "BET_YTD", "BET_YoY", "VariatieCA", "VariatieProfitNet", "PE", "PBV",
  "GradIndatorare", "CapitNetpeAct", "ROE", "ROA", "MarjaOperationala",
  "MarjaNeta", "DataURap", "PS", "PAvgProfit", "PBVxPE", "PretNWCPS", "nume",
  "RandDividendHist", "RandDividend", "capmln",
];

describe("get_stock_screen", () => {
  let harness;
  let allRows;

  before(async () => {
    harness = await startHarness({ startMock: false });
    allRows = jsonOf(await callTool(harness.client, "get_stock_screen", {}));
  });

  after(async () => {
    await harness?.close();
  });

  test("returns the whole snapshot when no filter is given", () => {
    assert.ok(Array.isArray(allRows));
    assert.ok(allRows.length > 100, `expected a few hundred rows, got ${allRows.length}`);
  });

  test("parses the documented columns out of the tab-separated export", () => {
    assert.deepEqual(Object.keys(allRows[0]).sort(), [...EXPECTED_COLUMNS].sort());
  });

  test("strips the Excel SEP= hint line rather than treating it as data", () => {
    assert.ok(
      allRows.every((row) => typeof row.Simbol === "string" && !row.Simbol.startsWith("SEP=")),
      "the SEP= hint line leaked into the rows"
    );
  });

  test("handles CRLF line endings without trailing carriage returns", () => {
    for (const row of allRows.slice(0, 20)) {
      for (const value of Object.values(row)) {
        if (typeof value === "string") {
          assert.ok(!value.includes("\r"), `stray CR in ${JSON.stringify(value)}`);
        }
      }
    }
  });

  test("coerces numeric cells to numbers and empty cells to null", () => {
    const priced = allRows.find((row) => row.Cotatie !== null);
    assert.equal(typeof priced.Cotatie, "number");
    assert.equal(typeof priced.nume, "string");
    assert.ok(
      allRows.some((row) => Object.values(row).includes(null)),
      "expected empty cells to become null somewhere in the snapshot"
    );
  });

  test("filters to the requested symbols", async () => {
    const wanted = allRows.slice(0, 3).map((row) => row.Simbol);
    const rows = jsonOf(await callTool(harness.client, "get_stock_screen", { symbols: wanted }));

    assert.deepEqual(rows.map((row) => row.Simbol), wanted);
  });

  test("returns nothing for a symbol that is not in the snapshot", async () => {
    const rows = jsonOf(
      await callTool(harness.client, "get_stock_screen", { symbols: ["NOT_A_SYMBOL"] })
    );
    assert.deepEqual(rows, []);
  });

  test("treats an empty symbol list as no filter", async () => {
    const rows = jsonOf(await callTool(harness.client, "get_stock_screen", { symbols: [] }));
    assert.equal(rows.length, allRows.length);
  });

  test("works without any API connection", () => {
    assert.equal(harness.mock, null); // the calls above ran against a dead port
  });
});
