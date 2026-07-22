# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

An MCP (Model Context Protocol) server exposing the Tradeville trading platform API
(https://api.tradeville.ro/) as tools. See [README.md](README.md) for user-facing setup/usage docs
and [doc/index.html](doc/index.html) for the vendored upstream API reference (Romanian).

## Build / run

```bash
npm install
npm run build   # tsc -> dist/
npm run dev     # tsc --watch
npm start        # node dist/index.js
```

No test suite exists yet. Verify changes by running the built server through the MCP Inspector CLI:

```bash
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call \
  --tool-name get_symbol --tool-arg symbol=BRD
```

These hit the **live public demo account** (`!DemoAPITDV`, default credentials) over the real
Tradeville WebSocket — there is no mock/sandbox. Be mindful of the API's rate limit (~20
commands/10s) when testing.

## Architecture

- [src/tradeville.ts](src/tradeville.ts) — `TradevilleClient`: owns the single WebSocket connection,
  lazy connect+login, and a serialized request queue (one in-flight request at a time, with minimum
  spacing) that doubles as the rate-limit guard. Reconnects transparently on close/error.
- [src/columnar.ts](src/columnar.ts) — transposes the API's columnar table format into row objects.
- [src/tools.ts](src/tools.ts) — declarative tool definitions (name, description, zod schema, API
  `cmd`, param mapping). Add a new Tradeville command by adding an entry here.
- [src/index.ts](src/index.ts) — MCP server entrypoint; wires `tools.ts` definitions into
  `McpServer.registerTool()` over a stdio transport.
- [src/types.ts](src/types.ts) — shared types for the raw API response shape.

## Important gotchas (learned the hard way)

- **The upstream docs' "raw response" examples are misleading.** They show tabular payloads as bare
  columnar objects (e.g. `{Symbol: [...], Price: [...]}`), but the *actual* live response wraps
  tabular data under a `data` property: `{cmd, prm, data: {Symbol: [...], ...}}`. Non-tabular acks
  (e.g. `login`, `subscribe`) do appear at the top level with no `data` key. `columnar.ts` handles
  both shapes — verify against the live API (not just the docs) before changing this.
- **Errors arrive as a message with an `err` string property**, not as a WebSocket-level error or
  HTTP status. `TradevilleClient` rejects the pending request when it sees `err`; tool handlers in
  `index.ts` turn that into an MCP `isError: true` result.
- **Requests must be serialized.** The API doesn't correlate responses to requests by ID — it
  relies on responses arriving in the same order requests were sent. Do not add concurrent/parallel
  `client.request()` pipelining without re-verifying ordering guarantees.
- **The public demo account can hit `"maxim 2 conexiuni per user !"`** if a previous connection
  wasn't fully closed (e.g. a crashed test process) or another user is testing concurrently. This is
  transient — retry after a few seconds rather than assuming a code regression.
- **Real-time `Subscribe` streaming is intentionally not implemented.** It doesn't map cleanly onto
  MCP's request/response tool model. Don't add it without discussing the design (e.g. a
  collect-for-N-seconds snapshot tool) first.
- Order placement is disabled by the API for live accounts and is out of scope for this project.

## Conventions

- Tools are named `snake_case`; API commands (`cmd` field) are the API's own `PascalCase`/mixed
  casing — don't rename the latter to match the former, it must match what the API expects.
- Tool descriptions should document the returned columns (models don't otherwise know the response
  shape ahead of a call) — follow the existing pattern in `tools.ts`.
- Dates are passed through as opaque strings (API accepts its own compact form like `"1oct20"` or
  ISO); don't add client-side date parsing/validation.
