#!/usr/bin/env node
/**
 * The `kapi` command published to npm (`npx kapi …`): the headless collection
 * runner and the MCP server, without cloning the repo.
 *
 *   kapi run <collection.json> [options]   — see cli/kapi-run.ts
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
  kapi run <collection.json> [--env <file.json>] [--folder <name|id>]
           [--iterations <n>] [--data <file.csv>] [--delay <ms>] [--json]
  kapi mcp            Start kapi's MCP server (stdio) for an AI CLI
  kapi mcp install    Register that server with claude / codex / gemini
  kapi --version

Desktop app: https://github.com/klejdi94/kapi/releases/latest`;

const [command, sub] = process.argv.slice(2);

if (command === 'run') {
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
