# kapi (CLI + MCP server)

The headless side of [kapi](https://github.com/klejdi94/kapi), the local-first API client. No account, no telemetry — it reads the JSON files you point it at.

## Run a collection in a terminal or CI

```bash
npx kapi run my-collection.kapi.json --env staging.json --iterations 5 --data users.csv
```

Accepts a kapi (`.kapi.json`) or Postman v2.1 collection export, an optional kapi or Postman environment export, and an optional CSV data file (one row per iteration). Pre-request and test scripts run in an isolated sandbox with a Postman-compatible `pm` API.

Exit code: `0` when every request passed its tests, `1` on a failure, `2` on a usage/config problem. Add `--json` for machine-readable output and `--folder <name>` to run one folder.

## Let an AI CLI drive kapi

```bash
npx kapi mcp install
```

Registers kapi's MCP server with whichever of `claude`, `codex` or `gemini` is installed (and adds a companion skill for Claude Code). Then, in any backend project: *"Use kapi to test this API — import its OpenAPI spec and run the tests."*

Get the desktop app from the [releases page](https://github.com/klejdi94/kapi/releases/latest).
