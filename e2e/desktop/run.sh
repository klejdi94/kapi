#!/usr/bin/env bash
# Desktop end-to-end suite. Needs: a built app (KAPI_APP, default the debug
# binary), tauri-driver and WebKitWebDriver, Xvfb, dbus + gnome-keyring, and
# python3 with selenium. CI installs all of these (see .github/workflows/ci.yml).
#   xvfb-run -a dbus-run-session -- e2e/desktop/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export KAPI_APP="${KAPI_APP:-$here/../../src-tauri/target/debug/app}"
export SHOTS="${SHOTS:-$here/shots}"
# A throwaway profile, so the run never touches real kapi data.
profile="$(mktemp -d)"
export HOME="$profile" XDG_DATA_HOME="$profile/.local/share" XDG_CONFIG_HOME="$profile/.config"
echo -n kapi-e2e | gnome-keyring-daemon --unlock --components=secrets >/dev/null

node "$here/servers.js" &
servers=$!
tauri-driver >"$SHOTS.tauri-driver.log" 2>&1 &
driver=$!
trap 'kill $servers $driver 2>/dev/null || true' EXIT
sleep 2
python3 "$here/test_desktop.py"
