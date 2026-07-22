import { z } from "zod";
import type { TradeParams } from "./types.js";

/**
 * Tools that forward to the Tradeville WebSocket API: each one issues a
 * single `cmd`/`prm` request and returns the columnar response. Tools backed
 * by something other than the API (e.g. local static data) are registered
 * separately in index.ts instead of living here — see src/stockscreen.ts.
 */
export interface ApiToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  schema: Shape;
  cmd: string;
  toParams(args: z.infer<z.ZodObject<Shape>>): TradeParams;
}

/** Preserves each tool's own arg shape for `toParams`, while still fitting in an `ApiToolDefinition[]`. */
function defineTool<Shape extends z.ZodRawShape>(tool: ApiToolDefinition<Shape>): ApiToolDefinition<Shape> {
  return tool;
}

const DATE_DESC =
  'Date string. Accepts the Tradeville compact form (e.g. "1oct20") or an ISO date ("2020-10-01").';

export const apiTools: ApiToolDefinition[] = [
  defineTool({
    name: "get_portfolio",
    description:
      "Get the account portfolio (holdings) as of a given date, or the current portfolio if no date is given. " +
      "Returns rows with: Account, Symbol, Quantity, AvgPrice, MarketPrice, PType (A=security, B=cash balance), Ccy.",
    schema: {
      date: z
        .string()
        .nullable()
        .optional()
        .describe(`${DATE_DESC} Omit or pass null for the current portfolio.`),
    },
    cmd: "Portfolio",
    toParams: (args) => ({ data: args.date ?? null }),
  }),
  defineTool({
    name: "search_symbol",
    description:
      "Search for tradeable symbols whose name contains the given term. Returns rows with: Symbol, Name, ISIN.",
    schema: {
      search: z.string().describe("Search term to match against symbol names."),
    },
    cmd: "SearchSymbol",
    toParams: (args) => ({ search: args.search }),
  }),
  defineTool({
    name: "get_symbol",
    description:
      "Get current market data and reference details for a single symbol: price, bid/ask, day range, trading limits, " +
      "market, currency, and (depending on instrument type) bond/structured-product fields like StrikePrice, YTM, CouponDate.",
    schema: {
      symbol: z.string().describe('Symbol code, e.g. "BRD".'),
    },
    cmd: "Symbol",
    toParams: (args) => ({ symbol: args.symbol }),
  }),
  defineTool({
    name: "get_market_depth",
    description:
      "Get order book depth (Level2) for a symbol: bid/ask price levels with quantities and order counts per level.",
    schema: {
      symbol: z.string().describe('Symbol code, e.g. "BRD".'),
      levels: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of price levels to return per side."),
    },
    cmd: "Level2",
    toParams: (args) => ({
      symbol: args.symbol,
      ...(args.levels != null ? { levels: args.levels } : {}),
    }),
  }),
  defineTool({
    name: "get_daily_values",
    description:
      "Get daily OHLCV history for a symbol over a date range. Returns rows with: Symbol, Date, Open, Low, High, Close, " +
      "Volume, Value, Trades.",
    schema: {
      symbol: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Symbol code. Can be omitted/null only if the range is a single day, in which case all symbols are returned."
        ),
      dstart: z.string().describe(DATE_DESC),
      dend: z.string().describe(DATE_DESC),
      adj: z
        .number()
        .int()
        .optional()
        .describe("Set to 1 to adjust for splits/consolidations/mergers (excludes dividends)."),
    },
    cmd: "DailyValues",
    toParams: (args) => ({
      symbol: args.symbol ?? null,
      dstart: args.dstart,
      dend: args.dend,
      ...(args.adj != null ? { adj: args.adj } : {}),
    }),
  }),
  defineTool({
    name: "get_trades",
    description:
      "Get individual trade ticks for a symbol over a date range. Returns rows with: Symbol, Date, Price, Volume, Trades, " +
      "Agres, BidQ, Bid, Ask, AskQ.",
    schema: {
      symbol: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Symbol code. Can be omitted/null only if the range is a single day, in which case trades for all symbols are returned."
        ),
      dstart: z.string().describe(DATE_DESC),
      dend: z.string().describe(DATE_DESC),
    },
    cmd: "Trades",
    toParams: (args) => ({ symbol: args.symbol ?? null, dstart: args.dstart, dend: args.dend }),
  }),
  defineTool({
    name: "get_activity",
    description:
      "Get account activity (trades, deposits/withdrawals) for a symbol, or all symbols, over a date range. Returns rows with: " +
      "Date, OpType (e.g. Buy/Sell/In/Out), Symbol, Quantity, Price, Comission, Ammount, CashPos, InstrPos, Profit, TranzNo, Ccy, " +
      "Obs, AvgPrice, OrderId.",
    schema: {
      symbol: z
        .string()
        .nullable()
        .optional()
        .describe("Symbol code, or omit/null for activity across all symbols."),
      dstart: z.string().describe(DATE_DESC),
      dend: z.string().describe(DATE_DESC),
    },
    cmd: "Activity",
    toParams: (args) => ({ symbol: args.symbol ?? null, dstart: args.dstart, dend: args.dend }),
  }),
  defineTool({
    name: "get_orders",
    description:
      "Get orders placed on a symbol, optionally starting from a given date. Returns rows with: OrderId, Symbol, Status, " +
      "TrdStatus, Date, OpType, ActiveQty, Quantity, Price, NetPrice, NewPrice.",
    schema: {
      symbol: z.string().describe('Symbol code, e.g. "BRD".'),
      dstart: z
        .string()
        .nullable()
        .optional()
        .describe(`${DATE_DESC} Omit or pass null for no start-date filter.`),
    },
    cmd: "Orders",
    toParams: (args) => ({ symbol: args.symbol, dstart: args.dstart ?? null }),
  }),
  defineTool({
    name: "get_fx_rates",
    description:
      "Get official BNR (Romanian National Bank) exchange rates for a currency over a date range, or all currencies if none " +
      "given. Returns rows with: Ccy, Date, Rate.",
    schema: {
      ccy: z
        .string()
        .nullable()
        .optional()
        .describe('Currency code, e.g. "EUR". Omit or pass null for all currencies.'),
      dstart: z.string().describe(DATE_DESC),
      dend: z.string().describe(DATE_DESC),
    },
    cmd: "FXBNR",
    toParams: (args) => ({ ccy: args.ccy ?? null, dstart: args.dstart, dend: args.dend }),
  }),
];
