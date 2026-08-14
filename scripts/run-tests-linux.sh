#!/usr/bin/env bash
# Runs the integration tests with an unlocked Secret Service, which secret-tool
# needs and headless machines lack. Everything stays inside one dbus-run-session
# because the server the tests spawn shells out to secret-tool itself, so it has
# to inherit the bus that stored the credentials.
#
# Usage: dbus-run-session -- ./scripts/run-tests-linux.sh
set -euo pipefail

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo "No session bus. Re-run as: dbus-run-session -- $0" >&2
  exit 1
fi

# Empty password; the daemon prints the env vars it wants exported.
eval "$(printf '\n' | gnome-keyring-daemon --unlock --components=secrets)"
export GNOME_KEYRING_CONTROL

node scripts/setup-test-credentials.mjs
node --test --test-reporter=spec "tests/**/*.test.mjs"
