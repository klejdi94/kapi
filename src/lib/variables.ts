import type { Collection, KV, Workspace } from '@/types';

export interface VarEntry {
  value: string;
  source: 'environment' | 'collection' | 'global' | 'dynamic';
  /** Environment name / collection name, for the resolver popover. */
  origin: string;
}

export type VarScope = Map<string, VarEntry>;

const VAR_PATTERN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

/**
 * Values kapi generates on the fly, mirroring Postman's `$`-prefixed variables.
 * They're evaluated per substitution, so two `{{$guid}}` uses give two guids.
 */
const DYNAMIC: Record<string, () => string> = {
  $guid: () => crypto.randomUUID(),
  $uuid: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1000)),
  $randomAlphaNumeric: () => Math.random().toString(36).slice(2, 10),
  $randomEmail: () => `${Math.random().toString(36).slice(2, 8)}@example.com`,
  $randomUserName: () => `user_${Math.random().toString(36).slice(2, 7)}`,
  $randomUrl: () => `https://${Math.random().toString(36).slice(2, 8)}.example.com`,
  $randomIP: () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 255)).join('.'),
};

export const DYNAMIC_VARIABLE_NAMES = Object.keys(DYNAMIC);

function addRows(scope: VarScope, rows: KV[], source: VarEntry['source'], origin: string) {
  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue;
    scope.set(row.key.trim(), { value: row.value, source, origin });
  }
}

/**
 * Later writes win, so the insertion order below *is* the precedence rule:
 * globals are the weakest, the active environment is the strongest.
 */
export function buildScope(workspace: Workspace, collection: Collection | null): VarScope {
  const scope: VarScope = new Map();
  addRows(scope, workspace.globals, 'global', 'Globals');
  if (collection) addRows(scope, collection.variables, 'collection', collection.name);
  const env = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
  if (env) addRows(scope, env.variables, 'environment', env.name);
  return scope;
}

export function lookup(scope: VarScope, name: string): VarEntry | null {
  const key = name.trim();
  const found = scope.get(key);
  if (found) return found;
  const dynamic = DYNAMIC[key];
  if (dynamic) return { value: dynamic(), source: 'dynamic', origin: 'Dynamic' };
  return null;
}

/** Substitutes `{{name}}`. Unknown names are left verbatim so the user sees them. */
export function resolve(text: string, scope: VarScope, depth = 0): string {
  if (!text || !text.includes('{{')) return text;
  const out = text.replace(VAR_PATTERN, (whole, name: string) => {
    const entry = lookup(scope, name);
    return entry ? entry.value : whole;
  });
  // Variables may reference other variables; bounded to avoid cycles.
  if (out !== text && out.includes('{{') && depth < 5) return resolve(out, scope, depth + 1);
  return out;
}

export interface VarUsage {
  name: string;
  entry: VarEntry | null;
}

/** Every variable referenced by the given strings, in first-seen order. */
export function collectUsages(texts: string[], scope: VarScope): VarUsage[] {
  const seen = new Map<string, VarUsage>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(VAR_PATTERN)) {
      const name = match[1].trim();
      if (seen.has(name)) continue;
      seen.set(name, { name, entry: lookup(scope, name) });
    }
  }
  return [...seen.values()];
}

export function missingNames(usages: VarUsage[]): string[] {
  return usages.filter((u) => !u.entry).map((u) => u.name);
}

/** Positions of `{{…}}` runs, so an input can underline them. */
export function variableSpans(text: string): { start: number; end: number; name: string }[] {
  const spans: { start: number; end: number; name: string }[] = [];
  for (const match of text.matchAll(VAR_PATTERN)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length, name: match[1].trim() });
  }
  return spans;
}
