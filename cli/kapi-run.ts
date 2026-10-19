#!/usr/bin/env -S npx tsx
/**
 * kapi, headless — the same pre-request → send → test pipeline the app uses
 * (see `src/cli/headlessRunner.ts`), for CI or a terminal. No app instance,
 * no window, no Zustand store: it reads exported JSON files straight off disk.
 *
 * Usage:
 *   kapi run  <collection.json> [options]     functional run, like the app's Runner
 *   kapi load <collection.json> [options]     load test with concurrent virtual users
 *   (from a clone: npm run cli -- run …)
 *
 * Shared options:
 *   --env <file.json>        Environment (kapi {variables:[...]} or a Postman export)
 *   --globals <file.json>    Globals, same formats as --env
 *   --folder <name|id>       Only this folder instead of the whole collection
 *   --data <file.csv>        One row per iteration
 *   --json                   Machine-readable output
 *   --no-cookies             Don't keep cookies between requests
 *
 * run:
 *   --iterations <n>         Repeat the run (default: data rows, or 1)
 *   --delay <ms>             Pause between requests (default 0)
 *   --export-environment <file.json>   Write the environment as the run left it
 *   --export-globals <file.json>       Write the globals as the run left it
 *
 * load:
 *   --vus <n>                Concurrent virtual users (default 10)
 *   --duration <time>        e.g. 30s, 2m (default 30s unless --iterations is given)
 *   --iterations <n>         Iterations per virtual user instead of / as well as a duration
 *   --ramp-up <time>         Start users gradually over this window (default 0)
 *   --think <ms>             Pause after each request, per user (default 0)
 *   --no-scripts             Skip pre-request/test scripts for raw throughput
 *   --threshold <expr>       Fail the run unless it holds, e.g. p95<500, errors<1, rps>=50 (repeatable)
 *
 * Exit codes: 0 all good, 1 test/threshold failure, 2 usage or config problem.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { Collection, Environment, KV, RequestDef } from '@/types';
import { parseCsv } from '@/lib/csv';
import { setScriptSandbox } from '@/lib/scripting';
import { nodeSandbox } from '@/lib/scripting/nodeSandbox';
import { locate, walk } from '@/lib/tree';
import { looksLikePostmanCollection, importPostmanCollection, looksLikePostmanEnvironment, importPostmanEnvironment } from '@/lib/importers/postman';
import { exportPostmanEnvironment } from '@/lib/exporters/postman';
import { runHeadless, headlessTargetsFor, type HeadlessResult } from '@/cli/headlessRunner';
import { send } from '@/lib/send';
import { memoryCookieJar, withCookieJar } from '@/lib/cookieSend';
import type { VarScope } from '@/lib/variables';
import { checkThreshold, startLoadTest, summarize, type LoadSample, type LoadSummary } from '@/lib/loadTest';

// Collection scripts may come from anyone who shared the collection — they run
// in an isolated vm context, never with this process's own Node APIs.
setScriptSandbox(nodeSandbox);

class UsageError extends Error {}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolvePath(process.cwd(), path), 'utf-8'));
  } catch (err) {
    throw new UsageError(`Could not read ${path}: ${(err as Error).message}`);
  }
}

function loadCollection(path: string): Collection {
  const data = readJson(path);
  if (looksLikePostmanCollection(data)) return importPostmanCollection(data);
  const maybe = data as Partial<Collection>;
  if (Array.isArray(maybe.items) && typeof maybe.name === 'string') return maybe as Collection;
  throw new UsageError(`${path} doesn't look like a kapi or Postman v2.1 collection export.`);
}

function loadEnvironment(path: string): Environment {
  const data = readJson(path);
  if (looksLikePostmanEnvironment(data)) return importPostmanEnvironment(data);
  const maybe = data as Partial<Environment>;
  if (Array.isArray(maybe.variables)) return { id: 'cli-env', name: maybe.name ?? 'CLI environment', variables: maybe.variables as KV[] };
  throw new UsageError(`${path} doesn't look like a kapi or Postman environment export.`);
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
  if (!found) throw new UsageError(`No folder named or id'd "${nameOrId}" in this collection.`);
  return found;
}

/** `30s`, `2m`, `1500ms`, or a bare number of seconds. */
function parseDuration(text: string, flag: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim());
  if (!match) throw new UsageError(`${flag} expects a time like 30s, 2m or 500ms — got "${text}".`);
  const n = Number(match[1]);
  return Math.round(n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(match[2] ?? 's') as 'ms' | 's' | 'm' | 'h']);
}

function positiveInt(text: string | undefined, flag: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} expects a whole number of 1 or more.`);
  return n;
}

interface Args {
  command: string;
  file: string;
  env: string | null;
  globals: string | null;
  folder: string | null;
  iterations: number | null;
  data: string | null;
  delay: number;
  json: boolean;
  cookies: boolean;
  exportEnv: string | null;
  exportGlobals: string | null;
  vus: number;
  durationMs: number | null;
  rampUpMs: number;
  thinkMs: number;
  scripts: boolean;
  thresholds: string[];
}

function parseArgs(argv: string[]): Args {
  const [command, file, ...rest] = argv;
  const args: Args = {
    command, file, env: null, globals: null, folder: null, iterations: null, data: null, delay: 0, json: false, cookies: true,
    exportEnv: null, exportGlobals: null, vus: 10, durationMs: null, rampUpMs: 0, thinkMs: 0, scripts: true, thresholds: [],
  };
  const value = (i: number, flag: string) => {
    const v = rest[i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value.`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case '--env': args.env = value(++i, flag); break;
      case '--globals': args.globals = value(++i, flag); break;
      case '--folder': args.folder = value(++i, flag); break;
      case '--iterations': args.iterations = positiveInt(value(++i, flag), flag); break;
      case '--data': args.data = value(++i, flag); break;
      case '--delay': args.delay = Number(value(++i, flag)) || 0; break;
      case '--json': args.json = true; break;
      case '--no-cookies': args.cookies = false; break;
      case '--export-environment': args.exportEnv = value(++i, flag); break;
      case '--export-globals': args.exportGlobals = value(++i, flag); break;
      case '--vus': args.vus = positiveInt(value(++i, flag), flag); break;
      case '--duration': args.durationMs = parseDuration(value(++i, flag), flag); break;
      case '--ramp-up': args.rampUpMs = parseDuration(value(++i, flag), flag); break;
      case '--think': args.thinkMs = Number(value(++i, flag)) || 0; break;
      case '--no-scripts': args.scripts = false; break;
      case '--threshold': args.thresholds.push(value(++i, flag)); break;
      default: throw new UsageError(`Unknown option: ${flag}`);
    }
  }
  return args;
}

type Sender = (request: RequestDef, scope: VarScope) => ReturnType<typeof send>;

function makeSender(cookies: boolean): Sender {
  const plain: Sender = (request, scope) => send(request, scope, {});
  return cookies ? withCookieJar(memoryCookieJar(), plain) : plain;
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

function writeJson(path: string, data: unknown) {
  writeFileSync(resolvePath(process.cwd(), path), JSON.stringify(data, null, 2) + '\n');
}

async function runCommand(args: Args) {
  const collection = loadCollection(args.file);
  const environment = args.env ? loadEnvironment(args.env) : null;
  const globals = args.globals ? loadEnvironment(args.globals).variables : [];
  const dataRows = args.data ? parseCsv(readFileSync(resolvePath(process.cwd(), args.data), 'utf-8')) : [];
  const targets = headlessTargetsFor(collection, args.folder ? findFolderId(collection, args.folder) : null);
  if (!targets.length) throw new UsageError('Nothing to run — this collection (or folder) has no requests.');

  // A data file drives the iteration count by default, same as the GUI runner.
  const iterations = args.iterations ?? (dataRows.length || 1);
  const results: HeadlessResult[] = [];
  const final = await runHeadless({
    collection, globals, environment, targets, iterations, dataRows, delayMs: args.delay,
    sendFn: makeSender(args.cookies),
    onResult: (r) => results.push(r),
  });

  if (args.exportEnv) writeJson(args.exportEnv, exportPostmanEnvironment(final.environment));
  if (args.exportGlobals) writeJson(args.exportGlobals, exportPostmanEnvironment({ id: 'globals', name: 'Globals', variables: final.globals }));

  if (args.json) console.log(JSON.stringify(results, null, 2));
  else printHuman(results);
  return results.every((r) => r.status === 'passed') ? 0 : 1;
}

function ms(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}

function printLoad(summary: LoadSummary, vus: number) {
  const l = summary.latency;
  console.log(`\n${summary.requests} requests from ${vus} virtual users in ${ms(summary.elapsedMs)} — ${summary.throughput.toFixed(1)} req/s`);
  console.log(`errors   ${(summary.errorRate * 100).toFixed(2)}% (${summary.failed} failed tests, ${summary.errored} errors)`);
  console.log(`latency  min ${ms(l.min)} · p50 ${ms(l.p50)} · p90 ${ms(l.p90)} · p95 ${ms(l.p95)} · p99 ${ms(l.p99)} · max ${ms(l.max)}`);
  console.log(`status   ${Object.entries(summary.statusCodes).map(([code, n]) => `${code}×${n}`).join('  ')}`);
  console.log('');
  const width = Math.max(...summary.byRequest.map((r) => `${r.method} ${r.name}`.length), 10);
  for (const r of summary.byRequest) {
    console.log(`  ${`${r.method} ${r.name}`.padEnd(width)}  ${String(r.count).padStart(6)}  p50 ${ms(r.p50).padStart(7)}  p95 ${ms(r.p95).padStart(7)}  err ${(r.errorRate * 100).toFixed(1)}%`);
  }
}

async function loadCommand(args: Args) {
  const collection = loadCollection(args.file);
  const environment = args.env ? loadEnvironment(args.env) : null;
  const globals = args.globals ? loadEnvironment(args.globals).variables : [];
  const dataRows = args.data ? parseCsv(readFileSync(resolvePath(process.cwd(), args.data), 'utf-8')) : [];
  const targets = headlessTargetsFor(collection, args.folder ? findFolderId(collection, args.folder) : null);
  if (!targets.length) throw new UsageError('Nothing to run — this collection (or folder) has no requests.');
  const durationMs = args.durationMs ?? (args.iterations ? undefined : 30_000);
  const thresholds = args.thresholds;
  // Validate thresholds before spending a minute on the test.
  for (const t of thresholds) checkThreshold(t, summarize([], 1));

  const samples: LoadSample[] = [];
  const started = Date.now();
  const run = startLoadTest(
    { collection, globals, environment, targets, dataRows, sendFnFor: () => makeSender(args.cookies) },
    { virtualUsers: args.vus, durationMs, iterationsPerUser: args.iterations ?? undefined, rampUpMs: args.rampUpMs, thinkTimeMs: args.thinkMs, runScripts: args.scripts },
    (s) => samples.push(s),
  );
  const onSigint = () => run.stop();
  process.once('SIGINT', onSigint);

  let ticker: ReturnType<typeof setInterval> | undefined;
  if (!args.json && process.stderr.isTTY) {
    ticker = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      process.stderr.write(`\r  ${elapsed.toFixed(0)}s · ${samples.length} requests · ${(samples.length / Math.max(elapsed, 0.001)).toFixed(1)} req/s   `);
    }, 500);
  }
  await run.done;
  if (ticker) {
    clearInterval(ticker);
    process.stderr.write('\n');
  }
  process.off('SIGINT', onSigint);

  const summary = summarize(samples, Date.now() - started);
  const checks = thresholds.map((t) => checkThreshold(t, summary));
  if (args.json) {
    const { timeline, ...rest } = summary;
    console.log(JSON.stringify({ ...rest, timeline, thresholds: checks }, null, 2));
  } else {
    printLoad(summary, args.vus);
    if (checks.length) {
      console.log('');
      for (const c of checks) console.log(`${c.passed ? '✓' : '✗'} ${c.expression} (actual ${Number.isInteger(c.actual) ? c.actual : c.actual.toFixed(2)})`);
    }
  }
  return checks.every((c) => c.passed) ? 0 : 1;
}

const USAGE = 'Usage: kapi run|load <collection.json> [options] — see `kapi --help`';

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.file || (args.command !== 'run' && args.command !== 'load')) throw new UsageError(USAGE);
    process.exit(args.command === 'load' ? await loadCommand(args) : await runCommand(args));
  } catch (err) {
    console.error(err instanceof UsageError ? err.message : `kapi: ${(err as Error).stack ?? err}`);
    process.exit(2);
  }
}

await main();
