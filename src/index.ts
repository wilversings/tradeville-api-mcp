#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TradevilleClient } from "./tradeville.js";
import { columnarToRows } from "./columnar.js";
import { tools } from "./tools.js";

const client = new TradevilleClient();

const server = new McpServer({
  name: "tradeville-api-mcp",
  version: "0.1.0",
});

for (const tool of tools) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.schema },
    async (args) => {
      try {
        const params = tool.toParams(args ?? {});
        const response = await client.request(tool.cmd, params);
        const rows = columnarToRows(response);
        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function shutdown() {
  client.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("Fatal error starting tradeville-api-mcp:", err);
  process.exit(1);
});
