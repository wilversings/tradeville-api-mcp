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

Credentials are read from the OS keyring (freedesktop Secret Service / KWallet, via `secret-tool`)
— never from environment variables or a config file — so a real account's password never has to
sit in plaintext in an MCP client config (e.g. `~/.claude.json`), which is often
world-readable-by-you-but-synced/backed-up and read by many tools.

Store your credentials once:

```bash
secret-tool store --label 'Tradeville API user' service tradeville-api-mcp key user
secret-tool store --label 'Tradeville API password' service tradeville-api-mcp key pass
```

Requires a running Secret Service provider (GNOME Keyring, KWallet's `ksecretd`, etc.) and
`secret-tool` (`libsecret-tools` / `libsecret` package).

If credentials aren't stored, the server still starts and the MCP handshake still completes —
tool calls fail with a clear setup error instead (a crashed server before the handshake completes
just shows a generic "Connection closed" with no detail).

## Registering with an MCP client

Example for Claude Desktop / Claude Code (`mcpServers` config):

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

No `env` block needed — the server resolves credentials from the keyring itself at startup.

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
