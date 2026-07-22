# tradeville-api-mcp

An MCP (Model Context Protocol) server exposing the [Tradeville](https://www.tradeville.eu/) trading
platform API (https://api.tradeville.ro/) as tools: account portfolio and activity reporting, plus
Romanian (BVB) and international market data.

The underlying API is **WebSocket-only** (`wss://api.tradeville.ro:443`, subprotocol `apitv`) and is
**read-only for reporting** — this server does not place orders. See `doc/index.html` for the vendored
API reference (Romanian).

## Setup

```bash
npm install
npm run build
```

## Configuration

Credentials are read from environment variables. If unset, they default to Tradeville's public
read-only demo account, so the server works out-of-the-box with no configuration:

| Variable    | Default          | Description                                  |
|-------------|------------------|-----------------------------------------------|
| `TDV_USER`  | `!DemoAPITDV`    | Tradeville user code (`coduser`)              |
| `TDV_PASS`  | `DemoAPITDV`     | Account password (`parola`)                   |
| `TDV_DEMO`  | `true`           | Whether the account is a demo account         |

Copy `.env.example` for reference; the server reads `process.env` directly (use your MCP client's
env config, or a tool like `dotenv-cli`, to set these when running).

## Registering with an MCP client

Example for Claude Desktop / Claude Code (`mcpServers` config):

```json
{
  "mcpServers": {
    "tradeville": {
      "command": "node",
      "args": ["/absolute/path/to/tradeville-api-mcp/dist/index.js"],
      "env": {
        "TDV_USER": "your-user-code",
        "TDV_PASS": "your-password",
        "TDV_DEMO": "false"
      }
    }
  }
}
```

Omit `env` entirely to use the public demo account.

## Tools

| Tool                | Description                                                        |
|----------------------|--------------------------------------------------------------------|
| `get_portfolio`      | Current or historical account holdings                             |
| `search_symbol`      | Search symbols by name                                              |
| `get_symbol`         | Current quote and reference data for a symbol                      |
| `get_market_depth`   | Order book depth (Level2) for a symbol                             |
| `get_daily_values`   | Daily OHLCV history for a symbol/date range                        |
| `get_trades`         | Individual trade ticks for a symbol/date range                     |
| `get_activity`       | Account activity (trades, deposits/withdrawals) for a date range   |
| `get_orders`         | Orders placed on a symbol                                           |
| `get_fx_rates`       | Official BNR exchange rates for a currency/date range               |

All tools return an array of row objects (the API's native columnar responses are transposed for
readability). Dates accept either the API's compact form (`"1oct20"`) or an ISO date
(`"2020-10-01"`).

Real-time streaming quotes (the API's `Subscribe` command) are intentionally not exposed, since
long-lived push updates don't map cleanly onto MCP's request/response tool model. Use `get_symbol`
for on-demand current quotes.

## Notes

- The API enforces a rate limit of roughly 20 commands per 10 seconds; this server serializes all
  requests over a single connection with spacing to stay well under that limit.
- The connection lazily connects and logs in on first tool call, and transparently reconnects if
  the connection drops.

## Development

```bash
npm run dev    # tsc --watch
npx @modelcontextprotocol/inspector node dist/index.js   # interactive protocol inspector
```
