# Security policy

kapi handles credentials, tokens and requests to private APIs, so security reports are very welcome.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/klejdi94/kapi/security/advisories/new) instead,
with steps to reproduce and the version you tested. You should hear back within a week.

## Supported versions

Only the latest release gets fixes. kapi updates itself in place (Help → Check for Updates…).

## How kapi is put together, security-wise

- **Collection scripts** (pre-request and test) run in a sandbox: a disposable Web Worker with no Tauri
  IPC in the app, and a fresh `node:vm` context in the CLI and MCP server. They can't read files, run
  commands or reach the app's own state; their only way out is `pm.sendRequest`.
- **The webview** runs under a Content-Security-Policy, and can only call the native commands listed in
  `src-tauri/capabilities/`. `git` is limited to the exact invocations kapi makes.
- **Secret variables** are encrypted at rest (AES-256-GCM) with a key held in the OS keychain.
- **AI CLIs** receive prompts over stdin, never as command-line arguments.
- **Updates** are only installed when signed with the key whose public half ships in the app.
