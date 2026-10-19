#!/usr/bin/env bash
# Desktop end-to-end suite. Needs: a built app (KAPI_APP, default the debug
# binary), tauri-driver and WebKitWebDriver, Xvfb, dbus + gnome-keyring, and
# python3 with selenium. CI installs all of these (see .github/workflows/ci.yml).
#   xvfb-run -a dbus-run-session -- e2e/desktop/run.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export KAPI_APP="${KAPI_APP:-$here/../../src-tauri/target/debug/app}"
export SHOTS="${SHOTS:-$here/shots}"
mkdir -p "$SHOTS"

fail() {
  # An annotation is readable on the CI run without downloading logs.
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=desktop e2e setup::$1"
  echo "✗ $1" >&2
  exit 1
}

[ -x "$KAPI_APP" ] || fail "app binary not found at $KAPI_APP"
command -v tauri-driver >/dev/null || fail "tauri-driver is not installed"
command -v WebKitWebDriver >/dev/null || fail "WebKitWebDriver is not installed (webkit2gtk-driver)"

# A throwaway profile, so the run never touches real kapi data.
profile="$(mktemp -d)"
export HOME="$profile" XDG_DATA_HOME="$profile/.local/share" XDG_CONFIG_HOME="$profile/.config"
if ! echo -n kapi-e2e | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>"$SHOTS/keyring.log"; then
  fail "gnome-keyring-daemon could not start: $(head -c 400 "$SHOTS/keyring.log")"
fi

node "$here/servers.js" >"$SHOTS/servers.log" 2>&1 &
servers=$!
tauri-driver >"$SHOTS/tauri-driver.log" 2>&1 &
driver=$!
trap 'kill $servers $driver 2>/dev/null || true' EXIT
sleep 3
kill -0 $servers 2>/dev/null || fail "test servers exited: $(head -c 400 "$SHOTS/servers.log")"
kill -0 $driver 2>/dev/null || fail "tauri-driver exited: $(head -c 400 "$SHOTS/tauri-driver.log")"

python3 "$here/test_desktop.py"
status=$?
if [ $status -ne 0 ] && [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::error title=tauri-driver log::$(tail -c 900 "$SHOTS/tauri-driver.log" | tr '\n' ' ')"
fi
exit $status
