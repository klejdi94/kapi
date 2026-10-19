/**
 * The boundary between kapi and a user's pre-request / test script.
 *
 * Scripts arrive from places kapi doesn't control — an imported Postman
 * collection, a teammate's commit pulled into a git-backed workspace — so they
 * never run in the app's own realm. The desktop app runs them in a Web Worker
 * (no Tauri IPC, so no filesystem, shell or native HTTP), the CLI and MCP
 * server in a fresh `node:vm` context with nothing but `pm` in it. Both speak
 * the same JSON-only protocol to `createKapiRuntime` (see runtime.ts); the
 * only capability a script gets back out is `pm.sendRequest`, which goes
 * through the host's normal send path — the same reach the request itself has.
 */

export interface SandboxRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

export interface SandboxResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  text: string;
  timeMs: number;
}

export interface SandboxInput {
  script: string;
  phase: 'prerequest' | 'test';
  environment: Record<string, string>;
  environmentName?: string;
  globals: Record<string, string>;
  collectionVariables: Record<string, string>;
  iterationData?: Record<string, string>;
  request: { method: string; url: string; headers: [string, string][] };
  response?: SandboxResponse;
  info?: { requestName?: string; requestId?: string; iteration?: number; iterationCount?: number };
}

export interface SandboxOutput {
  environment: Record<string, string>;
  globals: Record<string, string>;
  collectionVariables: Record<string, string>;
  /** Only set when the script changed them — `null` means "leave the request as it was". */
  request: { url: string | null; headers: [string, string][] | null };
  logs: string[];
  tests: { name: string; passed: boolean; error: string | null }[];
  error: string | null;
}

export type SandboxSend = (request: SandboxRequest) => Promise<SandboxResponse>;

export interface ScriptSandbox {
  run(input: SandboxInput, send: SandboxSend | undefined, timeoutMs: number): Promise<SandboxOutput>;
}

/** Wall-clock budget for one script, including any `pm.sendRequest` round-trips it waits on. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;

let current: ScriptSandbox | null = null;

/** Called once at startup by each entry point (app, CLI, MCP server, test setup). */
export function setScriptSandbox(sandbox: ScriptSandbox): void {
  current = sandbox;
}

export function getScriptSandbox(): ScriptSandbox {
  if (!current) throw new Error('No script sandbox registered — call setScriptSandbox() at startup.');
  return current;
}

/** Validates what came back over the wire, so a hostile script can't hand the host anything but plain data. */
export function parseSandboxMessage(raw: unknown): { type: 'send'; id: number; request: SandboxRequest } | { type: 'done'; result: SandboxOutput } | null {
  if (typeof raw !== 'string') return null;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (m.type === 'send' && typeof m.id === 'number' && m.request && typeof m.request === 'object') {
    const r = m.request as Record<string, unknown>;
    return {
      type: 'send',
      id: m.id,
      request: {
        method: String(r.method ?? 'GET'),
        url: String(r.url ?? ''),
        headers: stringPairs(r.headers),
        body: typeof r.body === 'string' ? r.body : '',
      },
    };
  }
  if (m.type === 'done' && m.result && typeof m.result === 'object') {
    const r = m.result as Record<string, unknown>;
    const req = (r.request ?? {}) as Record<string, unknown>;
    return {
      type: 'done',
      result: {
        environment: stringRecord(r.environment),
        globals: stringRecord(r.globals),
        collectionVariables: stringRecord(r.collectionVariables),
        request: {
          url: typeof req.url === 'string' ? req.url : null,
          headers: Array.isArray(req.headers) ? stringPairs(req.headers) : null,
        },
        logs: Array.isArray(r.logs) ? r.logs.map(String) : [],
        tests: Array.isArray(r.tests)
          ? r.tests.map((t) => {
              const test = (t ?? {}) as Record<string, unknown>;
              return { name: String(test.name ?? ''), passed: test.passed === true, error: test.error == null ? null : String(test.error) };
            })
          : [],
        error: r.error == null ? null : String(r.error),
      },
    };
  }
  return null;
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value)) out[key] = String(v);
  }
  return out;
}

function stringPairs(value: unknown): [string, string][] {
  if (!Array.isArray(value)) return [];
  return value.filter((pair) => Array.isArray(pair) && pair.length >= 2).map((pair) => [String(pair[0]), String(pair[1])]);
}

export function timeoutOutput(input: SandboxInput, timeoutMs: number): SandboxOutput {
  return {
    environment: input.environment,
    globals: input.globals,
    collectionVariables: input.collectionVariables,
    request: { url: null, headers: null },
    logs: [],
    tests: [],
    error: `Script timed out after ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`} and was stopped`,
  };
}
