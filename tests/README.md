# Integration tests

Black-box tests of the MCP server. Each one spawns the built `dist/index.js` as a real child
process, talks to it over stdio with the MCP SDK's own client, and points it at a local mock of the
Tradeville WebSocket protocol. Nothing inside the server is stubbed or imported directly — if a test
passes, the shipped binary genuinely does that.

## Running them

```bash
npm test                                          # macOS / Windows
dbus-run-session -- ./scripts/run-tests-linux.sh  # Linux
```

Linux needs the extra wrapper because `secret-tool` requires a Secret Service provider, which a
headless machine has no session for. The wrapper starts one, unlocks a keyring, and runs everything
inside it — the server spawns `secret-tool` itself, so it has to inherit the same session bus.

To run the tests directly (build and credentials already in place):

```bash
npm run test:setup        # provision fixture credentials into the OS secret store
npm run test:integration  # node --test
```

## Why real credentials

The suite mocks the *API*, not the *credential store*. `src/credentials.ts` is the only part of the
server that differs by platform — `secret-tool` on Linux, `security`/keychain on macOS, DPAPI via
PowerShell on Windows — so it is the part a three-OS matrix actually earns its keep on. The tests
assert on the username and password the server put on the wire, which only match if the real
platform backend read the real stored values back.

`scripts/setup-test-credentials.mjs` writes throwaway fixture values under the
`tradeville-api-mcp-test` namespace, never the production `tradeville-api-mcp` one, so running the
tests cannot overwrite your own stored credentials.

## Files

| File | Covers |
|------|--------|
| `discovery.test.mjs` | Handshake metadata, instructions, the tool catalogue and every input schema |
| `apiTools.test.mjs` | All nine API-backed tools: argument → `cmd`/`prm` mapping, and columnar → rows |
| `stockScreen.test.mjs` | `get_stock_screen`, the CSV-backed tool, with the API unreachable |
| `credentials.test.mjs` | Reading credentials from each platform's secret store, and the setup hint when absent |
| `connection.test.mjs` | Request serialization, reconnect, and the response envelope shapes |
| `errors.test.mjs` | API errors, unreachable API, and argument validation |
| `helpers/mockTradeville.mjs` | The mock API: columnar fixtures, error injection, connection drops |
| `helpers/mcpHarness.mjs` | Spawns the server, wires up the MCP client, asserts on tool results |

## Adding a tool

1. Add a fixture for its API command to `FIXTURES` in `helpers/mockTradeville.mjs`.
2. Add a case to `CASES` in `apiTools.test.mjs` pinning the params it sends.
3. Add it to `EXPECTED_TOOLS` in `discovery.test.mjs`, which pins the full catalogue.
