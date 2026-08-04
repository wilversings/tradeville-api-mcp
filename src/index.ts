#!/usr/bin/env node
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TradevilleClient } from "./tradeville.js";
import { columnarToRows } from "./columnar.js";
import { apiTools } from "./apiTools.js";
import { getStockScreen } from "./stockscreen.js";

const client = new TradevilleClient();

const server = new McpServer(
  {
    name: "tradeville-api-mcp",
    version: "0.1.0",
  },
  {
    instructions:
      "Data quality varies by market. BVB (Bucharest Stock Exchange)-listed symbols are Tradeville's " +
      "home market — treat quotes, history, and screening data for them as accurate and trustworthy. " +
      "For non-BVB / foreign symbols (US and other international markets), treat returned data as a " +
      "starting point rather than ground truth: it may be delayed, thinly covered, or otherwise less " +
      "reliable than for BVB names. Cross-check foreign-symbol data against another source before " +
      "relying on it for anything consequential.",
  }
);

for (const tool of apiTools) {
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

server.registerTool(
  "get_stock_screen",
  {
    description:
      "Get fundamental/valuation screening data for BVB-listed (Bucharest Stock Exchange) stocks, from a " +
      "static CSV export of the stock screener on the Tradeville web portal (portal.tradeville.ro) — not " +
      "live data, and not from the api.tradeville.ro WebSocket API used by the other tools. Freshness " +
      "depends on when the export was last taken. Returns rows with: Simbol, Cotatie (price), Capitalizare (market cap), " +
      "MedieZilnicaTranz (avg daily traded value), VarYoY, VarYTD, BET_YTD, BET_YoY, VariatieCA, VariatieProfitNet, " +
      "PE, PBV, GradIndatorare (leverage), CapitNetpeAct, ROE, ROA, MarjaOperationala, MarjaNeta, DataURap " +
      "(latest report date), PS, PAvgProfit, PBVxPE, PretNWCPS, nume (company name), RandDividendHist, " +
      "RandDividend, capmln.",
    inputSchema: {
      symbols: z
        .array(z.string())
        .optional()
        .describe('Symbol codes to filter to, e.g. ["BRD", "SNP"]. Omit for all symbols.'),
    },
  },
  async (args) => {
    try {
      const rows = getStockScreen(args?.symbols);
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
