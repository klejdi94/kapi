#!/usr/bin/env node
/**
 * The `kapi` command published to npm (`npx kapi …`): the headless collection
 * runner and the MCP server, without cloning the repo.
 *
 *   kapi run <collection.json> [options]   — functional run (see cli/kapi-run.ts)
 *   kapi load <collection.json> [options]  — load test with concurrent virtual users
 *   kapi mcp                               — start the MCP server on stdio
 *   kapi mcp install                       — register it with claude/codex/gemini
 *
 * Each command is loaded only when it's the one being run.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KAPI_VERSION } from '@/version';

const USAGE = `kapi ${KAPI_VERSION} — local-first API client, headless

Usage:
  kapi run <collection.json> [options]     Run every request and its tests once (or N times)
  kapi load <collection.json> [options]    Load test with concurrent virtual users
  kapi mcp            Start kapi's MCP server (stdio) for an AI CLI
  kapi mcp install    Register that server with claude / codex / gemini
  kapi --version

Options for run and load:
  --env <file>  --globals <file>  --folder <name|id>  --data <file.csv>  --json  --no-cookies
  --secret-refs   resolve op:// awssm:// vault:// values in --env/--globals via their CLIs
run:   --iterations <n>  --delay <ms>  --export-environment <file>  --export-globals <file>
load:  --vus <n>  --duration 30s  --iterations <n>  --ramp-up 10s  --think <ms>  --no-scripts
       --threshold p95<500  (repeatable; metrics p50 p90 p95 p99 max mean errors rps)

Exit codes: 0 all passed, 1 test or threshold failure, 2 usage/config problem.

Desktop app: https://github.com/klejdi94/kapi/releases/latest`;

const [command, sub] = process.argv.slice(2);

if (command === 'run' || command === 'load') {
  await import('./kapi-run.ts');
} else if (command === 'mcp' && sub === 'install') {
  const { installMcp } = await import('../mcp/install.ts');
  const here = dirname(fileURLToPath(import.meta.url));
  installMcp(['npx', '-y', 'kapi', 'mcp'], join(here, 'SKILL.md'));
} else if (command === 'mcp' && !sub) {
  await import('../mcp/server.ts');
} else if (command === '--version' || command === '-v') {
  console.log(KAPI_VERSION);
} else {
  console.log(USAGE);
  process.exit(command === undefined || command === '--help' || command === '-h' || command === 'help' ? 0 : 2);
}
