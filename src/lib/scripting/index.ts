import type { KapiResponse, KV, RequestDef } from '@/types';
import { kv } from '../factory';
import { DEFAULT_SCRIPT_TIMEOUT_MS, getScriptSandbox, type SandboxInput, type SandboxSend } from './sandbox';

export { setScriptSandbox, DEFAULT_SCRIPT_TIMEOUT_MS } from './sandbox';
export type { ScriptSandbox, SandboxSend, SandboxRequest, SandboxResponse } from './sandbox';

/**
 * Postman-style pre-request and test scripts. The `pm` API itself lives in
 * runtime.ts and always runs inside a sandbox (sandbox.ts) — this module only
 * converts kapi's variable rows to and from the plain records that cross that
 * boundary, and chains collection- and request-level scripts together.
 */
export interface ScriptResult {
  environment: KV[];
  globals: KV[];
  collectionVariables: KV[];
  /** What the script changed on the outgoing request; `null` fields mean unchanged. */
  request: { url: string | null; headers: [string, string][] | null };
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
  return [...updated.filter((r) => (r.key.trim() ? !r.enabled || r.key in record : true)), ...additions];
}

export interface ScriptContext {
  environment: KV[];
  environmentName?: string;
  globals: KV[];
  collectionVariables: KV[];
  request: { method: string; url: string; headers: [string, string][] };
  response?: { status: number; statusText: string; headers: [string, string][]; text: string; timeMs: number };
  iterationData?: Record<string, string>;
  info?: SandboxInput['info'];
}

export interface ScriptRunOptions {
  /** Executes `pm.sendRequest`; when omitted, the call fails with a clear error. */
  sendRequest?: SandboxSend;
  timeoutMs?: number;
}

/** Runs one script in the sandbox. Never throws — errors land in `result.error`. */
export async function runScript(script: string, phase: 'prerequest' | 'test', context: ScriptContext, options: ScriptRunOptions = {}): Promise<ScriptResult> {
  const unchanged: ScriptResult = {
    environment: context.environment,
    globals: context.globals,
    collectionVariables: context.collectionVariables,
    request: { url: null, headers: null },
    logs: [],
    error: null,
    tests: [],
  };
  if (!script.trim()) return unchanged;

  try {
    const output = await getScriptSandbox().run(
      {
        script,
        phase,
        environment: toRecord(context.environment),
        environmentName: context.environmentName,
        globals: toRecord(context.globals),
        collectionVariables: toRecord(context.collectionVariables),
        iterationData: context.iterationData,
        request: context.request,
        response: context.response,
        info: context.info,
      },
      options.sendRequest,
      options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
    );
    return {
      environment: fromRecord(context.environment, output.environment),
      globals: fromRecord(context.globals, output.globals),
      collectionVariables: fromRecord(context.collectionVariables, output.collectionVariables),
      request: output.request,
      logs: output.logs,
      error: output.error,
      tests: output.tests,
    };
  } catch (err) {
    return { ...unchanged, error: err instanceof Error ? err.message : String(err) };
  }
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

/** The three writable variable scopes a script can touch, threaded between chained scripts. */
export interface ScriptVars {
  environment: KV[];
  globals: KV[];
  collectionVariables: KV[];
}

export interface ChainOutcome {
  vars: ScriptVars;
  ran: boolean;
  logs: string[];
  errors: string[];
  tests: TestResult[];
  /** The request as the scripts left it — feed it to `applyScriptRequest` before sending. */
  request: ScriptContext['request'];
  requestChanged: boolean;
}

/**
 * Runs collection-level then request-level scripts, feeding each one's variable
 * writes (and request edits) into the next — matching Postman's execution
 * order, so a collection script can set up a value the request script then refines.
 */
export async function chainScripts(
  scripts: (string | undefined)[],
  vars: ScriptVars,
  base: Omit<ScriptContext, keyof ScriptVars>,
  phase: 'prerequest' | 'test',
  options: ScriptRunOptions = {},
): Promise<ChainOutcome> {
  const out: ChainOutcome = { vars, ran: false, logs: [], errors: [], tests: [], request: base.request, requestChanged: false };
  for (const script of scripts) {
    if (!script?.trim()) continue;
    out.ran = true;
    const result = await runScript(script, phase, { ...base, request: out.request, ...out.vars }, options);
    out.vars = {
      environment: result.environment,
      globals: result.globals,
      collectionVariables: result.collectionVariables,
    };
    if (result.request.url !== null || result.request.headers !== null) {
      out.request = {
        ...out.request,
        url: result.request.url ?? out.request.url,
        headers: result.request.headers ?? out.request.headers,
      };
      out.requestChanged = true;
    }
    out.logs.push(...result.logs);
    if (result.error) out.errors.push(result.error);
    out.tests.push(...result.tests);
  }
  return out;
}

/** The enabled, named headers of a request in the `[key, value]` shape scripts see. */
export function scriptRequestOf(request: RequestDef): ScriptContext['request'] {
  return {
    method: request.method,
    url: request.url,
    headers: request.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, h.value] as [string, string]),
  };
}

/**
 * Applies a pre-request script's `pm.request.url = …` / `pm.request.headers.add(…)`
 * edits to the request that's about to be sent. Disabled header rows are kept
 * as they were; the enabled ones are replaced by what the script left.
 */
export function applyScriptRequest(request: RequestDef, outcome: Pick<ChainOutcome, 'request' | 'requestChanged'>): RequestDef {
  if (!outcome.requestChanged) return request;
  const disabled = request.headers.filter((h) => !h.enabled || !h.key);
  const byKey = new Map(request.headers.filter((h) => h.enabled && h.key).map((h) => [`${h.key}\u0000${h.value}`, h]));
  const headers = outcome.request.headers.map(([key, value]) => byKey.get(`${key}\u0000${value}`) ?? kv({ key, value }));
  return { ...request, url: outcome.request.url, headers: [...headers, ...disabled] };
}
