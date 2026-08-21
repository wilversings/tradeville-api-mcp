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

## Tests

```bash
npm test                                          # build + provision credentials + run (macOS/Windows)
dbus-run-session -- ./scripts/run-tests-linux.sh  # Linux: needs an unlocked Secret Service session
```

`tests/` holds black-box integration tests: they spawn the built `dist/index.js` as a real child
process, drive it over stdio with the MCP SDK's own client, and point it at a local mock of the
Tradeville WebSocket protocol (`tests/helpers/mockTradeville.mjs`). Nothing inside the server is
stubbed. See [tests/README.md](tests/README.md) for the layout, and
[.github/workflows/tests.yml](.github/workflows/tests.yml) for the Linux/macOS/Windows matrix.

Two env vars exist solely so the tests can do this. Both are lookup keys, never secrets:

- `TRADEVILLE_WS_URL` — point the client at the mock instead of `wss://api.tradeville.ro:443`.
- `TRADEVILLE_CREDENTIAL_SERVICE` — the secret-store namespace to read. Tests use
  `tradeville-api-mcp-test` so they can never clobber real stored credentials.

The tests still read credentials through the genuine per-platform backend, which is the whole
reason the matrix spans three OSes — that code is the only part of the server that differs by
platform. `scripts/setup-test-credentials.mjs` provisions fixture values into the native store.

For a manual smoke test against the **live public demo account** (`!DemoAPITDV`, default
credentials), use the MCP Inspector CLI — but mind the API's rate limit (~20 commands/10s):

```bash
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call \
  --tool-name get_symbol --tool-arg symbol=BRD
```

## Architecture

- [src/tradeville.ts](src/tradeville.ts) — `TradevilleClient`: owns the single WebSocket connection,
  lazy connect+login, and a serialized request queue (one in-flight request at a time, with minimum
  spacing) that doubles as the rate-limit guard. Reconnects transparently on close/error.
- [src/columnar.ts](src/columnar.ts) — transposes the API's columnar table format into row objects.
- [src/apiTools.ts](src/apiTools.ts) — declarative tool definitions (name, description, zod schema,
  API `cmd`, param mapping). Add a new Tradeville command by adding an entry here.
- [src/index.ts](src/index.ts) — MCP server entrypoint; wires `apiTools.ts` definitions into
  `McpServer.registerTool()` over a stdio transport.
- [src/credentials.ts](src/credentials.ts) — reads the username/password from the OS secret store,
  with one backend per platform (`secret-tool` on Linux, `security`/keychain on macOS, DPAPI via
  PowerShell on Windows). Never reads a secret from an env var or config file.
- [src/types.ts](src/types.ts) — shared types for the raw API response shape.

Every file in `src/` serves a tool, and every tool forwards one API command or reads one local
file. That is the whole server. If a change adds arithmetic here, it is probably in the wrong
repository half — see **Publishing surface** below.

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
- **The rate limit is real and enforced as an `err` response**, not as a delay: exceed it and you get
  `"maxim 20 comenzi in 10 secunde"` and the request fails. `TradevilleClient` paces sends with a
  sliding window (18 per 10s, leaving headroom), which is the *only* place in the system that meters
  traffic — a client issuing one `get_symbol` per symbol across a ~500-symbol universe (e.g.
  [bond-ladder-web](https://github.com/wilversings/bond-ladder-web)'s market screen) relies on it
  entirely. Don't loosen it to make a caller faster, and don't add a second limiter in a client: it
  could only ever be wrong about the budget this one is spending.
- **`SearchSymbol` truncates** at roughly 33 rows with no indication it did, so `search_symbol` must
  never be used to enumerate the market. The only call that lists the universe is `DailyValues` with
  a null symbol over a single-day range, and even that omits anything that did not trade that
  session. Say so in a tool description rather than assuming callers will discover it.

## Publishing surface

**This package publishes an MCP server and nothing else.** `build.mjs` emits one artefact,
`dist/index.js`, bundled and minified so `npx tradeville-api-mcp` starts without installing anything
transitive. There is no `exports` map beyond the binary and no library entry point, on purpose.

The line this repository draws is between **the broker's data and an opinion about it**. A tool here
forwards one API command and transposes the response; it does not decide what counts as a bond, how
a coupon schedule is reconstructed from two dates, or which yields are trustworthy. Those are
judgements — defensible ones, with a suite behind them — but they are *someone's*, and shipping them
inside the server would make every consumer inherit them silently along with the data.

So the test for whether something belongs in `src/` is: **could the broker have returned it?** A
quote, a portfolio row, a BNR rate, yes. An inferred coupon frequency, a yield-to-maturity, a
tax-adjusted swap recommendation, no — those belong to a downstream client, such as
[bond-ladder-web](https://github.com/wilversings/bond-ladder-web) (formerly `web/` in this
repository; extracted since it has its own dependencies, tests and release cycle).

The cost of this is real and worth naming: an assistant talking to this server gets the API, not a
bond ladder, and has to do the analysis itself or call a client app's endpoints. That is the trade
that was chosen. If it ever needs revisiting, the fix is a new tool with a documented contract, not
an `exports` map that lets a consumer reach into internals which are free to change.

## Conventions

### Comments

Keep them minimal. Most code should carry none.

- Comment the code, not the change. A comment explains what is there now, for someone reading it
  cold. It is not a changelog: no "new", "now uses", "previously", "fixed", "added X so that", no
  reference to what the code used to do or to the task that prompted the edit. Git history covers
  that.
- Write them only for what the code cannot say itself: a non-obvious *why*, an upstream quirk being
  worked around, an invariant that looks safe to break but isn't. Prefer fixing an unclear name over
  explaining it.
- Never restate the code (`// loop over the rows`), label the obvious, or narrate a function
  step-by-step.
- One or two lines. If a comment needs a paragraph, it usually belongs in this file or the README.
- Same rules in tests. A test name should carry the intent; a comment is for why the assertion is
  non-obvious.

### Code

- Tools are named `snake_case`; API commands (`cmd` field) are the API's own `PascalCase`/mixed
  casing — don't rename the latter to match the former, it must match what the API expects.
- Tool descriptions should document the returned columns (models don't otherwise know the response
  shape ahead of a call) — follow the existing pattern in `apiTools.ts`.
- Dates are passed through as opaque strings (API accepts its own compact form like `"1oct20"` or
  ISO); don't add client-side date parsing/validation.
- Adding a tool means adding a case to `CASES` in [tests/apiTools.test.mjs](tests/apiTools.test.mjs)
  and a fixture in `tests/helpers/mockTradeville.mjs`; `tests/discovery.test.mjs` pins the full tool
  list, so it fails until the new tool is declared there too.
