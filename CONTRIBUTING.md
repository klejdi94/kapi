# Contributing to kapi

Thanks for helping. kapi is a local-first desktop API client (Tauri 2 + React + TypeScript) with a
headless CLI and an MCP server that share its core.

## Getting set up

```bash
npm install
npm run desktop:dev     # the app, with hot reload (needs Rust + the Tauri prerequisites for your OS)
npm run dev             # just the UI in a browser tab — fast, but requests hit CORS there
```

On Linux the desktop build also needs `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

## Before you open a PR

```bash
npm run typecheck && npm test && npm run build
npm run build:npm && node npm/dist/kapi.js --version
(cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

CI runs all of these on every push and pull request.

## Where things live

| Path | What |
| --- | --- |
| `src/` | The app's frontend. `src/lib` is framework-free logic (and where most tests are). |
| `src/lib/scripting/` | Pre-request/test scripts: the `pm` runtime and the sandboxes it runs in. |
| `src-tauri/` | The Rust shell: native commands, capabilities (what the webview may call), menus. |
| `cli/`, `src/cli/` | The headless runner behind `npx kapi run`. |
| `mcp/` | The MCP server behind `npx kapi mcp`. |
| `npm/` | The published `kapi` npm package (built by `scripts/build-npm.mjs`). |

## Ground rules

- **Nothing leaves the machine** unless the user sent it. No telemetry, no remote fonts or scripts,
  no "phone home" — the CSP in `tauri.conf.json` enforces most of this; please keep it strict.
- **Untrusted input stays untrusted.** Collection scripts, imported files, responses and anything from
  a pulled git workspace may come from someone else. Scripts only ever run in the sandbox
  (`src/lib/scripting/sandbox.ts`); new native commands need an explicit permission in
  `src-tauri/build.rs` and `capabilities/`; new `git` invocations need their own pinned scope.
- Prefer small, focused PRs with a test for the behaviour you changed.

## Reporting security issues

Please don't open a public issue — see [SECURITY.md](SECURITY.md).
