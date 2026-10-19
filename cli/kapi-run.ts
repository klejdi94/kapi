#!/usr/bin/env -S npx tsx
/**
 * Headless collection runner — the same pre-request → send → test pipeline
 * the GUI's "Run collection" uses (see `src/cli/headlessRunner.ts`), for CI
 * or a terminal. No app instance, no window, no Zustand store: it reads
 * exported JSON files straight off disk and prints results, so `kapi run`
 * can be a step in any pipeline that already has Node.
 *
 * Usage:
 *   npm run cli -- run <collection.json> [options]
 *
 * Options:
 *   --env <file.json>      Environment file (kapi-native {variables:[...]},
 *                          or a Postman v2.1 environment export)
 *   --folder <name|id>     Only run this folder instead of the whole collection
 *   --iterations <n>       Repeat the whole run this many times (default 1)
 *   --data <file.csv>      One row per iteration; ignored past the row count
 *                          if --iterations is smaller than the file
 *   --delay <ms>           Pause between requests (default 0)
 *   --json                 Print one JSON object instead of a human summary
 *
 * Exit code is 0 only when every request passed its tests (or ran with none
 * defined) and none errored — the thing a CI step actually checks.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { Collection, Environment, KV } from '@/types';
import { parseCsv } from '@/lib/csv';
import { setScriptSandbox } from '@/lib/scripting';
import { nodeSandbox } from '@/lib/scripting/nodeSandbox';
import { locate, walk } from '@/lib/tree';
import { looksLikePostmanCollection, importPostmanCollection, looksLikePostmanEnvironment, importPostmanEnvironment } from '@/lib/importers/postman';
import { runHeadless, headlessTargetsFor, type HeadlessResult } from '@/cli/headlessRunner';

// Collection scripts may come from anyone who shared the collection — they run
// in an isolated vm context, never with this process's own Node APIs.
setScriptSandbox(nodeSandbox);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolvePath(process.cwd(), path), 'utf-8'));
}

function loadCollection(path: string): Collection {
  const data = readJson(path);
  if (looksLikePostmanCollection(data)) return importPostmanCollection(data);
  const maybe = data as Partial<Collection>;
  if (Array.isArray(maybe.items) && typeof maybe.name === 'string') return maybe as Collection;
  throw new Error(`${path} doesn't look like a kapi or Postman v2.1 collection export.`);
}

function loadEnvironment(path: string): Environment {
  const data = readJson(path);
  if (looksLikePostmanEnvironment(data)) return importPostmanEnvironment(data);
  const maybe = data as Partial<Environment>;
  if (Array.isArray(maybe.variables)) return { id: 'cli-env', name: maybe.name ?? 'CLI environment', variables: maybe.variables as KV[] };
  throw new Error(`${path} doesn't look like a kapi or Postman environment export.`);
}

function findFolderId(collection: Collection, nameOrId: string): string {
  let found: string | null = null;
  walk(collection.items, (node) => {
    if (node.type === 'folder' && (node.id === nameOrId || node.name.toLowerCase() === nameOrId.toLowerCase())) found = node.id;
  });
  if (!found) {
    const located = locate(collection.items, nameOrId);
    if (located?.node.type === 'folder') found = located.node.id;
  }
  if (!found) throw new Error(`No folder named or id'd "${nameOrId}" in this collection.`);
  return found;
}

interface Args {
  command: string;
  file: string;
  env: string | null;
  folder: string | null;
  /** null means "not given on the command line" — a --data file's row count fills this in when it's still null. */
  iterations: number | null;
  data: string | null;
  delay: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command, file, ...rest] = argv;
  const args: Args = { command, file, env: null, folder: null, iterations: null, data: null, delay: 0, json: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--env') args.env = rest[++i];
    else if (flag === '--folder') args.folder = rest[++i];
    else if (flag === '--iterations') args.iterations = Number(rest[++i]) || 1;
    else if (flag === '--data') args.data = rest[++i];
    else if (flag === '--delay') args.delay = Number(rest[++i]) || 0;
    else if (flag === '--json') args.json = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return args;
}

function printHuman(results: HeadlessResult[]) {
  for (const r of results) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '⚠';
    const label = [...r.path, r.name].join(' / ');
    const testNote = r.tests.length ? ` — ${r.tests.filter((t) => t.passed).length}/${r.tests.length} tests` : '';
    console.log(`${icon} [it${r.iteration}] ${r.method} ${label} → ${r.httpStatus ?? 'error'} (${Math.round(r.durationMs)}ms)${testNote}`);
    if (r.errorMessage) console.log(`    ${r.errorMessage.split('\n').join('\n    ')}`);
    for (const t of r.tests.filter((t) => !t.passed)) console.log(`    ✗ ${t.name}${t.error ? `: ${t.error}` : ''}`);
  }
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed${failed ? `, ${failed} failed` : ''}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== 'run' || !args.file) {
    console.error('Usage: kapi run <collection.json> [--env <file.json>] [--folder <name|id>] [--iterations <n>] [--data <file.csv>] [--delay <ms>] [--json]');
    process.exit(2);
  }

  const collection = loadCollection(args.file);
  const environment = args.env ? loadEnvironment(args.env) : null;
  const dataRows = args.data ? parseCsv(readFileSync(resolvePath(process.cwd(), args.data), 'utf-8')) : [];
  const scopeNodeId = args.folder ? findFolderId(collection, args.folder) : null;
  const targets = headlessTargetsFor(collection, scopeNodeId);

  if (!targets.length) {
    console.error('Nothing to run — this collection (or folder) has no requests.');
    process.exit(2);
  }

  // A data file drives the iteration count by default, same as the GUI
  // runner — --iterations only needs to be passed to override that.
  const iterations = args.iterations ?? (dataRows.length || 1);

  const results: HeadlessResult[] = [];
  await runHeadless({
    collection,
    globals: [],
    environment,
    targets,
    iterations,
    dataRows,
    delayMs: args.delay,
    onResult: (r) => results.push(r),
  });

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printHuman(results);
  }

  const ok = results.every((r) => r.status === 'passed');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`kapi-run: ${(err as Error).message}`);
  process.exit(2);
});
