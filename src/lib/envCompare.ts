import type { Collection, Environment, KapiResponse, RequestDef, RunResult, Workspace } from '@/types';
import { buildScope, type VarScope } from './variables';
import { applyScriptRequest, chainScripts, scriptRequestOf } from './scripting';
import { makeScriptSender } from './scripting/sendBridge';

/**
 * Sends the same request through two environments and compares what came
 * back — e.g. staging against production before a release. Pre-request
 * scripts run (they often fetch tokens) but nothing is written back to the
 * workspace.
 */

export interface JsonChange {
  path: string;
  kind: 'added' | 'removed' | 'changed' | 'type';
  a?: unknown;
  b?: unknown;
}

/** Headers that differ on every response and would only add noise. */
export const VOLATILE_HEADERS = ['date', 'age', 'expires', 'last-modified', 'etag', 'x-request-id', 'x-amzn-requestid', 'x-amz-cf-id', 'cf-ray', 'server-timing', 'x-trace-id', 'traceparent', 'set-cookie', 'content-length', 'via', 'report-to', 'nel'];

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** A path → value diff of two JSON values. Paths look like `$.items[2].price`. */
export function diffJson(a: unknown, b: unknown, ignore: (path: string) => boolean = () => false, path = '$', out: JsonChange[] = [], limit = 500): JsonChange[] {
  if (out.length >= limit || ignore(path)) return out;
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    out.push({ path, kind: 'type', a, b });
    return out;
  }
  if (ta === 'array') {
    const aa = a as unknown[];
    const bb = b as unknown[];
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      const p = `${path}[${i}]`;
      if (i >= aa.length) out.push({ path: p, kind: 'added', b: bb[i] });
      else if (i >= bb.length) out.push({ path: p, kind: 'removed', a: aa[i] });
      else diffJson(aa[i], bb[i], ignore, p, out, limit);
    }
    return out;
  }
  if (ta === 'object') {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(oa), ...Object.keys(ob)])];
    for (const key of keys) {
      const p = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      if (ignore(p)) continue;
      if (!(key in oa)) out.push({ path: p, kind: 'added', b: ob[key] });
      else if (!(key in ob)) out.push({ path: p, kind: 'removed', a: oa[key] });
      else diffJson(oa[key], ob[key], ignore, p, out, limit);
    }
    return out;
  }
  if (a !== b) out.push({ path, kind: 'changed', a, b });
  return out;
}

/** `*` matches one path segment: `$.items[*].updatedAt`, `$.meta.*`. */
export function pathMatcher(patterns: string[]): (path: string) => boolean {
  const regexes = patterns
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const normalized = p.startsWith('$') ? p : `$.${p.replace(/^\./, '')}`;
      const escaped = normalized.replace(/[.+?^${}()|\\]/g, '\\$&').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\*/g, '[^.\\[\\]]+');
      return new RegExp(`^${escaped}$`);
    });
  return (path) => regexes.some((re) => re.test(path));
}

export interface HeaderChange {
  name: string;
  a: string | null;
  b: string | null;
}

export function diffHeaders(a: [string, string][], b: [string, string][], ignoreVolatile = true): HeaderChange[] {
  const collect = (headers: [string, string][]) => {
    const map = new Map<string, string>();
    for (const [k, v] of headers) {
      const key = k.toLowerCase();
      map.set(key, map.has(key) ? `${map.get(key)}, ${v}` : v);
    }
    return map;
  };
  const ma = collect(a);
  const mb = collect(b);
  const out: HeaderChange[] = [];
  for (const name of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    if (ignoreVolatile && VOLATILE_HEADERS.includes(name)) continue;
    const va = ma.get(name) ?? null;
    const vb = mb.get(name) ?? null;
    if (va !== vb) out.push({ name, a: va, b: vb });
  }
  return out;
}

export interface SideResult {
  environment: Environment | null;
  result: RunResult;
}

/** Runs the request (pre-request scripts included) with one environment, without persisting anything. */
export async function sendWithEnvironment(
  request: RequestDef,
  collectionScript: string | undefined,
  workspace: Workspace,
  collection: Collection | null,
  environment: Environment | null,
  sendFn: (request: RequestDef, scope: VarScope) => Promise<RunResult>,
): Promise<SideResult> {
  const vars = { environment: environment?.variables ?? [], globals: workspace.globals, collectionVariables: collection?.variables ?? [] };
  const scopeFor = (v: typeof vars) =>
    buildScope(
      { ...workspace, globals: v.globals, environments: environment ? [{ ...environment, variables: v.environment }] : [], activeEnvironmentId: environment?.id ?? null },
      collection ? { ...collection, variables: v.collectionVariables } : null,
    );
  const pre = await chainScripts([collectionScript, request.preRequestScript], vars, { request: scriptRequestOf(request), environmentName: environment?.name }, 'prerequest', {
    sendRequest: makeScriptSender(sendFn, scopeFor(vars), request),
  });
  const result = await sendFn(applyScriptRequest(request, pre), scopeFor(pre.vars));
  return { environment, result };
}

export interface Comparison {
  statusSame: boolean;
  headers: HeaderChange[];
  /** Null when either body isn't JSON (compare the text instead). */
  json: JsonChange[] | null;
  textSame: boolean;
}

export function compareResponses(a: KapiResponse, b: KapiResponse, ignorePaths: string[] = [], ignoreVolatileHeaders = true): Comparison {
  let json: JsonChange[] | null = null;
  try {
    json = diffJson(JSON.parse(a.text), JSON.parse(b.text), pathMatcher(ignorePaths));
  } catch {
    json = null;
  }
  return {
    statusSame: a.status === b.status,
    headers: diffHeaders(a.headers, b.headers, ignoreVolatileHeaders),
    json,
    textSame: a.text === b.text,
  };
}
