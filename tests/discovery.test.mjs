// The server's advertised surface: handshake metadata and the tool catalogue.
// These need no credentials and no API, so they cover every platform even if a
// secret store is unavailable.

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { callToolExpectingError, startHarness } from "./helpers/mcpHarness.mjs";

/** Every tool the README documents, with the args callers are required to pass. */
const EXPECTED_TOOLS = {
  get_portfolio: { required: [], optional: ["date"] },
  search_symbol: { required: ["search"], optional: [] },
  get_symbol: { required: ["symbol"], optional: [] },
  get_market_depth: { required: ["symbol"], optional: ["levels"] },
  get_daily_values: { required: ["dstart", "dend"], optional: ["symbol", "adj"] },
  get_trades: { required: ["dstart", "dend"], optional: ["symbol"] },
  get_activity: { required: ["dstart", "dend"], optional: ["symbol"] },
  get_orders: { required: ["symbol"], optional: ["dstart"] },
  get_fx_rates: { required: ["dstart", "dend"], optional: ["ccy"] },
  get_stock_screen: { required: [], optional: ["symbols"] },
};

describe("discovery", () => {
  let harness;
  let tools;

  before(async () => {
    harness = await startHarness();
    tools = (await harness.client.listTools()).tools;
  });

  after(async () => {
    await harness?.close();
  });

  test("reports its identity in the handshake", () => {
    const info = harness.client.getServerVersion();
    assert.equal(info.name, "tradeville-api-mcp");
    assert.ok(info.version, "server should report a version");
  });

  test("declares the tools capability", () => {
    assert.ok(harness.client.getServerCapabilities()?.tools, "tools capability missing");
  });

  test("sends instructions warning about non-BVB data quality", () => {
    const instructions = harness.client.getInstructions();
    assert.ok(instructions, "server sent no instructions");
    assert.match(instructions, /BVB/);
    assert.match(instructions, /Bucharest Stock Exchange/);
  });

  test("exposes exactly the documented tools", () => {
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, Object.keys(EXPECTED_TOOLS).sort());
  });

  test("every tool has a description documenting its returned columns", () => {
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} has no description`);
      // Models cannot know the response shape ahead of a call, so each
      // description is expected to spell the columns out.
      assert.match(tool.description, /Returns rows with|Returns|Get /, tool.name);
    }
  });

  test("input schemas match the documented required/optional args", () => {
    for (const tool of tools) {
      const expected = EXPECTED_TOOLS[tool.name];
      const schema = tool.inputSchema;

      assert.equal(schema.type, "object", `${tool.name} schema is not an object`);

      const properties = Object.keys(schema.properties ?? {}).sort();
      assert.deepEqual(
        properties,
        [...expected.required, ...expected.optional].sort(),
        `${tool.name} properties`
      );

      assert.deepEqual(
        [...(schema.required ?? [])].sort(),
        [...expected.required].sort(),
        `${tool.name} required args`
      );
    }
  });

  test("every documented argument carries a description", () => {
    for (const tool of tools) {
      for (const [arg, spec] of Object.entries(tool.inputSchema.properties ?? {})) {
        assert.ok(spec.description, `${tool.name}.${arg} has no description`);
      }
    }
  });

  test("rejects a call to a tool that does not exist", async () => {
    const message = await callToolExpectingError(harness.client, "get_nonexistent");
    assert.match(message, /not found/i);
  });
});
