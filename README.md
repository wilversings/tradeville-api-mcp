# Tradeville API MCP

An MCP (Model Context Protocol) server exposing the [Tradeville](https://www.tradeville.eu/) trading
platform API (https://api.tradeville.ro/): account portfolio/activity reporting plus Romanian (BVB)
and international market data.

The underlying API is **WebSocket-only** (`wss://api.tradeville.ro:443`, subprotocol `apitv`) and
**read-only for reporting** — this server does not place orders. See `doc/index.html` for the
vendored API reference (Romanian).

## Setup

```bash
npm install
npm run build
```

## Configuration

Credentials come from the OS keyring (freedesktop Secret Service / KWallet, via `secret-tool`), never
from environment variables or a config file — so a real password never sits in plaintext in an MCP
client config (e.g. `~/.claude.json`), which is often synced/backed up and readable by many tools.

```bash
secret-tool store --label 'Tradeville API user' service tradeville-api-mcp key user
secret-tool store --label 'Tradeville API password' service tradeville-api-mcp key pass
```

Requires a running Secret Service provider (GNOME Keyring, KWallet's `ksecretd`, etc.) and
`secret-tool` (`libsecret-tools` / `libsecret`).

If credentials aren't stored, the server still starts and completes the MCP handshake — tool calls
fail with a clear setup error instead of the generic "Connection closed" you'd get from a crash
before handshake.

## Registering with an MCP client

Via `npx` (fetches the [published package](https://www.npmjs.com/package/tradeville-api-mcp), no local
clone needed):

```json
{
  "mcpServers": {
    "tradeville": {
      "command": "npx",
      "args": ["-y", "tradeville-api-mcp"]
    }
  }
}
```

Or against a local build:

```json
{
  "mcpServers": {
    "tradeville": {
      "command": "node",
      "args": ["/absolute/path/to/tradeville-api-mcp/dist/index.js"]
    }
  }
}
```

No `env` block needed either way — credentials are resolved from the keyring at startup.

## Tools

| Tool               | Description                                                      |
|---------------------|-------------------------------------------------------------------|
| `get_portfolio`    | Current or historical account holdings                          |
| `search_symbol`    | Search symbols by name                                           |
| `get_symbol`       | Current quote and reference data for a symbol                    |
| `get_market_depth` | Order book depth (Level2) for a symbol                          |
| `get_daily_values` | Daily OHLCV history for a symbol/date range                      |
| `get_trades`       | Individual trade ticks for a symbol/date range                   |
| `get_activity`     | Account activity (trades, deposits/withdrawals) for a date range |
| `get_orders`       | Orders placed on a symbol                                        |
| `get_fx_rates`     | Official BNR exchange rates for a currency/date range             |
| `get_stock_screen` | Fundamental/valuation screening data for BVB stocks (static CSV export from the [Tradeville portal](https://portal.tradeville.ro/)'s stock screener) |

Results are arrays of row objects (columnar API responses transposed for readability). Dates accept
either the API's compact form (`"1oct20"`) or ISO (`"2020-10-01"`).

Real-time streaming quotes (`Subscribe`) aren't exposed since long-lived push updates don't map onto
MCP's request/response model — use `get_symbol` for on-demand quotes instead.

## Notes

- The API rate-limits to ~20 commands/10s; this server serializes requests over a single connection
  with spacing to stay well under that.
- The connection lazily connects/logs in on first tool call and transparently reconnects on drop.
- `get_stock_screen` doesn't call the WebSocket API at all: it reads `staticdata/stockscreen.csv`, a
  manually refreshed CSV export from the stock screener at
  [portal.tradeville.ro](https://portal.tradeville.ro/) (Tradeville's web trading portal, distinct
  from the `api.tradeville.ro` WebSocket API used by every other tool). Data is only as fresh as the
  last export.

## Development

```bash
npm run dev    # tsc --watch
npx @modelcontextprotocol/inspector node dist/index.js   # interactive protocol inspector
```
