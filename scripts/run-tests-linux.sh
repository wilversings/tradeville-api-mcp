#!/usr/bin/env bash
# Runs the integration tests on Linux inside a session with an unlocked
# Secret Service, which `secret-tool` (and therefore src/credentials.ts) needs.
#
# Headless machines and CI runners have no keyring session, so start one here.
# Everything must happen inside a single `dbus-run-session`: the MCP server is
# spawned by the tests and shells out to `secret-tool` itself, so it has to
# inherit the same session bus that stored the credentials.
#
# Usage: dbus-run-session -- ./scripts/run-tests-linux.sh
set -euo pipefail

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo "No session bus. Re-run as: dbus-run-session -- $0" >&2
  exit 1
fi

# Unlock with an empty password and keep only the secrets component; the daemon
# prints the env vars it wants exported.
eval "$(printf '\n' | gnome-keyring-daemon --unlock --components=secrets)"
export GNOME_KEYRING_CONTROL

node scripts/setup-test-credentials.mjs
node --test --test-reporter=spec "tests/**/*.test.mjs"
