# Tradeville API MCP

Connect your AI assistant to the [Tradeville](https://www.tradeville.eu/) brokerage. This is an
[MCP](https://modelcontextprotocol.io/) server that lets Claude (or any MCP-capable assistant) read
your account and pull Romanian (BVB) and international market data — so you can just *ask* about your
holdings, a stock's price history, the order book, exchange rates, and more, in plain language.

It's **read-only**: it reports on your account and the market, but never places, changes, or cancels
orders.

## What you can ask

Once it's connected, you can ask things like:

- *"What's in my portfolio right now, and what's my P/L?"*
- *"Show me TLV's daily prices for the last month."*
- *"What does the order book for SNP look like?"*
- *"List my trades and deposits since January."*
- *"What was the BNR EUR/RON rate last week?"*
- *"Screen BVB stocks by P/E and dividend yield."*

Behind those questions, the server exposes these tools:

| Tool               | What it gives you                                                |
|--------------------|------------------------------------------------------------------|
| `get_portfolio`    | Current or historical account holdings                           |
| `search_symbol`    | Find symbols by name                                             |
| `get_symbol`       | Current quote and reference data for a symbol                    |
| `get_market_depth` | Order-book depth (Level 2) for a symbol                          |
| `get_daily_values` | Daily OHLCV price history for a symbol                           |
| `get_trades`       | Individual trade ticks for a symbol                              |
| `get_activity`     | Account activity — trades, deposits, withdrawals                 |
| `get_orders`       | Orders placed on a symbol                                        |
| `get_fx_rates`     | Official BNR exchange rates for a currency                       |
| `get_stock_screen` | Fundamental / valuation screening data for BVB stocks            |

## Setup

### 1. Add it to your MCP client

You need [Node.js](https://nodejs.org/) 18 or newer. Then point your MCP client at the published
package — `npx` fetches and runs it, no manual install needed.

For **Claude Code**:

```bash
claude mcp add tradeville -- npx -y tradeville-api-mcp
```

For **Claude Desktop** (or any client that uses this config format), add to your MCP servers config:

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

### 2. Store your Tradeville credentials

Your Tradeville username and password are read from your operating system's **secure credential
store** — never from an environment variable or a config file. That means your real password never
sits in plaintext in a file like `~/.claude.json`, which is often synced, backed up, and readable by
other tools on your machine.

**Linux** — stored via the freedesktop Secret Service / KWallet, using `secret-tool`:

```bash
secret-tool store --label 'Tradeville API user' service tradeville-api-mcp key user
secret-tool store --label 'Tradeville API password' service tradeville-api-mcp key pass
```

This needs a running secret-service provider (GNOME Keyring, KWallet's `ksecretd`, etc.) and the
`secret-tool` command (from the `libsecret-tools` / `libsecret` package).

**Windows** — encrypted with DPAPI (tied to your Windows user account, nothing extra to install), via
PowerShell:

```powershell
$dir = "$env:APPDATA\tradeville-api-mcp"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
Read-Host -AsSecureString "Tradeville user" | ConvertFrom-SecureString | Set-Content "$dir\user.dat"
Read-Host -AsSecureString "Tradeville password" | ConvertFrom-SecureString | Set-Content "$dir\pass.dat"
```

### 3. Start asking

Restart or reconnect your MCP client and you're ready to go. If you haven't stored credentials yet,
the server still connects — the first tool call just returns a clear message telling you how to set
them up, rather than failing silently.

## Good to know

- **Dates** can be written either as the API's compact form (`"1oct20"`) or as ISO (`"2020-10-01"`).
- **Results** come back as plain tables (arrays of row objects), ready for your assistant to read and
  summarize.
- **Rate limits** are handled for you — requests are queued over a single connection and paced to stay
  within Tradeville's limits, and the connection reconnects automatically if it drops.
- **No live streaming.** For a current price, ask for a quote (`get_symbol`) on demand; continuous
  push updates don't fit MCP's request/response model.
- **Stock-screen data** (`get_stock_screen`) is a periodically refreshed export from the stock
  screener at [portal.tradeville.ro](https://portal.tradeville.ro/), so it's only as fresh as the last
  export — unlike every other tool, which pulls live from the API.
- **Data reliability differs by market.** BVB (Bucharest Stock Exchange) data is Tradeville's home
  turf and can be trusted. Data for foreign symbols is passed through the same tools but is worth a
  second check against another source before you rely on it — the server tells connected assistants
  this too, so expect them to flag it.

## Building from source

Prefer to run your own build instead of `npx`? Clone the repo and:

```bash
npm install
npm run build
```

Then point your client at the local build:

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

Handy during development:

```bash
npm run dev    # tsc --watch
npx @modelcontextprotocol/inspector node dist/index.js   # interactive MCP inspector
```

The underlying Tradeville API is WebSocket-only (`wss://api.tradeville.ro:443`, subprotocol `apitv`)
and read-only for reporting. The vendored API reference (in Romanian) is in `doc/index.html`.

## License

MIT
