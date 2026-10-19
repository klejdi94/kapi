# Changelog

All notable changes to kapi. Versions follow [semver](https://semver.org).

## 0.4.0 — 2026-10-19

### Security
- Collection scripts now run in a sandbox (a disposable Web Worker in the app, an isolated `vm`
  context in the CLI and MCP server) instead of the app's own window. Previously a script in an
  imported collection or a pulled git workspace could read and write files or run commands.
- On Windows, prompts to the AI CLIs could be interpreted by `cmd.exe`; they now go over stdin.
- The webview runs under a Content-Security-Policy, and `git` can only be run with the exact
  arguments kapi uses.
- Secret variables are encrypted at rest with a key stored in the OS keychain.

### Added
- `npx kapi run`, `npx kapi mcp` and `npx kapi mcp install` — no clone needed.
- Much fuller `pm` API: chai-style `pm.expect`, `pm.response.to.have.status/header/jsonBody`,
  `pm.response.to.be.ok/json`, `pm.sendRequest` (callbacks or `await`), `pm.iterationData`,
  `pm.variables.set/replaceIn`, `pm.info`, editing `pm.request` headers and URL, legacy
  `postman.*` / `tests[…]`, and a clear error for `require()`.
- Scripts that loop forever are stopped after 30 seconds.
- Test generation works with Codex and Gemini, not only Claude.
- Optional macOS Developer ID / notarization and Windows Authenticode signing in the release workflow.

### Fixed
- Saves are atomic, keep a `.bak` of the previous version, and recover from a damaged file.
- Closing the window or quitting right after an edit no longer risks losing it.
- Disabled variables were dropped whenever a script ran.
- Pre-request script errors were not shown in collection runner results.
