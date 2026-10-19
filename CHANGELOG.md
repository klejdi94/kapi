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
- Secret variables and auth credentials (tokens, passwords, API keys, AWS secret keys…) are encrypted
  at rest with a key stored in the OS keychain — in the workspace file, open tabs and history.
- Git snapshots no longer contain literal auth credentials or secret-flagged collection variables;
  pulling keeps your local values.

### Added
- **Monitors**: run a collection or folder on a schedule while kapi is open (every 5 minutes to daily),
  with a system notification on failure or on a status change, results in History, and a ready-made
  GitHub Actions workflow for when kapi is closed.
- **Contract testing from OpenAPI**: requests imported or synced from a spec keep its documented
  responses, and every response is checked for a documented status and a body matching the schema
  (OpenAPI 3.0/3.1 and Swagger 2, `$ref`s and `nullable` handled) — in the app, the Runner and the CLI,
  with no tests to write. Switch it off per request in Settings.
- Scripts can `require()` **lodash, crypto-js, moment, uuid and xml2js** like in Postman, and the legacy
  `_`, `CryptoJS` and `xml2Json` globals work — evaluated inside the sandbox.
- **gRPC**: schemas from server reflection or `.proto` files (compiled in-app, imports included),
  unary and all three streaming kinds, metadata, deadlines, TLS and mTLS, streamed responses shown
  live. Saved gRPC requests keep their compiled schema.
- **Load testing** in the Runner and as `kapi load`: concurrent virtual users for a duration or
  N iterations, ramp-up, think time, live p50/p95/p99, throughput and errors, per-request breakdown,
  JSON export, and `--threshold` checks for CI.
- **AWS Signature V4** and **HTTP Digest** (MD5/SHA-256) authentication.
- `kapi run` keeps cookies between requests and gains `--globals`, `--export-environment` and
  `--export-globals`.
- A desktop end-to-end suite that drives the real app in CI.
- `npx kapi run`, `npx kapi mcp` and `npx kapi mcp install` — no clone needed.
- Much fuller `pm` API: chai-style `pm.expect`, `pm.response.to.have.status/header/jsonBody`,
  `pm.response.to.be.ok/json`, `pm.sendRequest` (callbacks or `await`), `pm.iterationData`,
  `pm.variables.set/replaceIn`, `pm.info`, editing `pm.request` headers and URL, legacy
  `postman.*` / `tests[…]`, and a clear error for `require()`.
- Scripts that loop forever are stopped after 30 seconds.
- Test generation works with Codex and Gemini, not only Claude.
- Optional macOS Developer ID / notarization and Windows Authenticode signing in the release workflow.

### Fixed
- Requests to a non-default port (e.g. `localhost:3000`) were refused by the desktop app's HTTP scope.
- Saves are atomic, keep a `.bak` of the previous version, and recover from a damaged file.
- Closing the window or quitting right after an edit no longer risks losing it.
- Disabled variables were dropped whenever a script ran.
- Pre-request script errors were not shown in collection runner results.
