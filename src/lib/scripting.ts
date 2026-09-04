import type { KapiResponse, KV } from '@/types';
import { kv } from './factory';

/**
 * A Postman-style `pm` object, backed by the three variable scopes kapi
 * already has. Scripts run in-process (this is a personal desktop tool —
 * the trust boundary is "the user trusts scripts they wrote themselves",
 * same as a shell alias), but only `pm` and `console` are handed in, so a
 * script has no direct reference to the app's own state or DOM.
 */
export interface ScriptResult {
  environment: KV[];
  globals: KV[];
  collectionVariables: KV[];
  logs: string[];
  error: string | null;
  tests: TestResult[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  error: string | null;
}

function toRecord(rows: KV[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) if (row.enabled && row.key.trim()) out[row.key] = row.value;
  return out;
}

/** Merges script-side writes back into the row list, preserving row metadata and order. */
function fromRecord(original: KV[], record: Record<string, string>): KV[] {
  const seen = new Set<string>();
  const updated = original.map((row) => {
    if (!row.key.trim()) return row;
    seen.add(row.key);
    if (!(row.key in record)) return row; // deleted by the script
    return row.value === record[row.key] ? row : { ...row, value: record[row.key], enabled: true };
  });
  const additions = Object.entries(record)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => kv({ key, value }));
  return [...updated.filter((r) => r.key.trim() ? r.key in record : true), ...additions];
}

export interface ScriptContext {
  environment: KV[];
  globals: KV[];
  collectionVariables: KV[];
  request: { method: string; url: string; headers: [string, string][] };
  response?: { status: number; statusText: string; headers: [string, string][]; text: string; timeMs: number };
}

/** Builds the `pm` object and runs `script` against it. Never throws — errors land in `result.error`. */
export function runScript(script: string, context: ScriptContext): ScriptResult {
  const logs: string[] = [];
  const tests: TestResult[] = [];
  const env = toRecord(context.environment);
  const globals = toRecord(context.globals);
  const collectionVars = toRecord(context.collectionVariables);

  if (!script.trim()) {
    return { environment: context.environment, globals: context.globals, collectionVariables: context.collectionVariables, logs, error: null, tests };
  }

  const makeScope = (store: Record<string, string>) => ({
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => {
      store[key] = String(value);
    },
    unset: (key: string) => {
      delete store[key];
    },
    has: (key: string) => key in store,
  });

  const responseBody = context.response?.text ?? '';
  const pm = {
    environment: makeScope(env),
    globals: makeScope(globals),
    collectionVariables: makeScope(collectionVars),
    variables: {
      get: (key: string) => env[key] ?? collectionVars[key] ?? globals[key],
    },
    request: {
      method: context.request.method,
      url: context.request.url,
      headers: context.request.headers.map(([key, value]) => ({ key, value })),
    },
    response: context.response
      ? {
          code: context.response.status,
          status: context.response.statusText,
          headers: context.response.headers.map(([key, value]) => ({ key, value })),
          responseTime: context.response.timeMs,
          text: () => responseBody,
          json: () => JSON.parse(responseBody),
        }
      : undefined,
    test: (name: string, fn: () => void) => {
      try {
        fn();
        tests.push({ name, passed: true, error: null });
      } catch (err) {
        tests.push({ name, passed: false, error: (err as Error).message });
      }
    },
    expect: (actual: unknown) => ({
      to: {
        equal: (expected: unknown) => {
          if (actual !== expected) throw new Error(`expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
        },
        include: (expected: unknown) => {
          const ok = typeof actual === 'string' || Array.isArray(actual) ? actual.includes(expected as never) : false;
          if (!ok) throw new Error(`expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
        },
      },
    }),
  };

  const sandboxedConsole = {
    log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
  };

  let error: string | null = null;
  try {
    const runner = new Function('pm', 'console', `"use strict";\n${script}`);
    runner(pm, sandboxedConsole);
  } catch (err) {
    error = (err as Error).message;
  }

  return {
    environment: fromRecord(context.environment, env),
    globals: fromRecord(context.globals, globals),
    collectionVariables: fromRecord(context.collectionVariables, collectionVars),
    logs,
    error,
    tests,
  };
}

export function responseToScriptInput(response: KapiResponse): ScriptContext['response'] {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    text: response.binary ? '' : response.text,
    timeMs: response.timings.total,
  };
}
