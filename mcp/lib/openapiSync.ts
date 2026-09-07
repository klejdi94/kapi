import { readFile } from 'node:fs/promises';
import type { Collection, FolderNode, OpenApiHistoryEntry, RequestNode, TreeNode } from '@/types';
import { importOpenApi, parseOpenApiText } from '@/lib/importers/openapi';
import { diffOpenApiSpecs, type OpenApiDiff } from '@/lib/openapiDiff';
import { uid } from '@/lib/factory';
import { allRequests } from '@/lib/tree';
import { readStore, updateStore, STORE_OPENAPI_HISTORY, STORE_WORKSPACES } from './fileStore.ts';
import { findCollectionAndWorkspace, pickWorkspace, readWorkspaceState, type WorkspaceStoreState } from './workspaceOps.ts';

const MAX_HISTORY = 200;
const STORE_OPENAPI_SPECS = 'kapi.openapi-specs';
const SPEC_PROBE_PATHS = ['/openapi.json', '/openapi.yaml', '/swagger.json', '/v3/api-docs', '/v2/api-docs', '/api-docs', '/swagger/v1/swagger.json'];

export interface OpenApiSource {
  /** A URL to fetch, a local file path to read, or an origin to probe the common spec paths on. */
  kind: 'url' | 'file' | 'probe';
  value: string;
}

interface SpecRecord {
  collectionId: string;
  source: string;
  doc: unknown;
  at: number;
}

async function loadSpecText(source: OpenApiSource): Promise<{ text: string; label: string }> {
  if (source.kind === 'file') {
    return { text: await readFile(source.value, 'utf-8'), label: source.value };
  }
  if (source.kind === 'url') {
    const res = await fetch(source.value);
    if (!res.ok) throw new Error(`GET ${source.value} → HTTP ${res.status}`);
    return { text: await res.text(), label: source.value };
  }
  // 'probe': the handful of paths a real backend actually publishes its spec
  // at, tried in turn — same list `src/lib/discovery.ts`'s `probeApiSpec`
  // uses, ported here without `@tauri-apps/plugin-http` since this process
  // has no Tauri runtime.
  const base = source.value.replace(/\/+$/, '');
  for (const path of SPEC_PROBE_PATHS) {
    const url = `${base}${path}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
      if (!res.ok) continue;
      const text = await res.text();
      if (text.trim()) return { text, label: url };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`No OpenAPI/Swagger spec found at any of ${SPEC_PROBE_PATHS.join(', ')} under ${base}`);
}

/** Everything after the host (or `{{variable}}`) prefix — same split `src/lib/exporters/openapi.ts` uses, so a synced collection's URLs key the same way a freshly-imported one's do. */
function pathOf(url: string): string {
  const match = /^(https?:\/\/[^/]+|\{\{[^}]+\}\})/.exec(url);
  const rest = match ? url.slice(match[1].length) : url.startsWith('/') ? url : `/${url}`;
  return rest.split(/[?#]/)[0] || '/';
}

function keyOf(method: string, url: string): string {
  return `${method.toUpperCase()} ${pathOf(url)}`;
}

function freshByKey(fresh: Collection): Map<string, RequestNode> {
  const map = new Map<string, RequestNode>();
  for (const { node } of allRequests(fresh)) map.set(keyOf(node.request.method, node.request.url), node);
  return map;
}

/** Fresh's tree, pruned to only the operations that had no match in the existing collection — this is what actually gets appended. */
function unmatchedSubtree(items: TreeNode[], matchedKeys: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of items) {
    if (node.type === 'folder') {
      const filtered = unmatchedSubtree(node.items, matchedKeys);
      if (filtered.length) out.push({ ...node, items: filtered });
    } else if (node.type === 'request') {
      if (!matchedKeys.has(keyOf(node.request.method, node.request.url))) out.push(node);
    }
  }
  return out;
}

function appendUnmatched(existingItems: TreeNode[], unmatchedTopLevel: TreeNode[]): TreeNode[] {
  const result = [...existingItems];
  for (const node of unmatchedTopLevel) {
    if (node.type === 'folder') {
      const idx = result.findIndex((e) => e.type === 'folder' && e.name === node.name);
      if (idx >= 0) {
        const existingFolder = result[idx] as FolderNode;
        result[idx] = { ...existingFolder, items: [...existingFolder.items, ...node.items] };
      } else {
        result.push(node);
      }
    } else {
      result.push(node);
    }
  }
  return result;
}

/**
 * Merges a freshly-imported spec onto an existing collection instead of
 * replacing it: matched operations (same method + path) keep their id, auth,
 * scripts, description, examples and body untouched, only their
 * spec-derived `params`/`pathVars`/`headers` scaffolding is refreshed;
 * operations no longer in the spec are left exactly as they are (surfaced in
 * the diff, never silently deleted); brand-new operations are appended,
 * grouped into an existing same-named folder when there is one. Same
 * cautious spirit as the `.env` importer's merge-by-key (see
 * `EnvironmentsPanel.tsx`) — a re-sync should never destroy work a person
 * already put into a request.
 */
function mergeCollectionWithSpec(existing: Collection, fresh: Collection): Collection {
  const freshMap = freshByKey(fresh);
  const matchedKeys = new Set<string>();

  function updateMatched(items: TreeNode[]): TreeNode[] {
    return items.map((node) => {
      if (node.type === 'folder') return { ...node, items: updateMatched(node.items) };
      if (node.type === 'websocket') return node;
      const key = keyOf(node.request.method, node.request.url);
      const match = freshMap.get(key);
      if (!match) return node;
      matchedKeys.add(key);
      return {
        ...node,
        request: { ...node.request, params: match.request.params, pathVars: match.request.pathVars, headers: match.request.headers },
      };
    });
  }

  const updated = updateMatched(existing.items);
  const unmatched = unmatchedSubtree(fresh.items, matchedKeys);
  return { ...existing, items: appendUnmatched(updated, unmatched) };
}

export interface SyncOpenApiInput {
  workspaceId?: string;
  collectionId?: string;
  name?: string;
  source: OpenApiSource;
}

export interface SyncOpenApiResult {
  collectionId: string;
  collectionName: string;
  diff: OpenApiDiff;
  sourceLabel: string;
}

export async function syncOpenApi(input: SyncOpenApiInput): Promise<SyncOpenApiResult | { error: string }> {
  const { text, label } = await loadSpecText(input.source);
  const doc = parseOpenApiText(text) as { paths?: Record<string, unknown> };
  if (!doc || typeof doc !== 'object' || !doc.paths) {
    return { error: `${label} doesn't look like an OpenAPI/Swagger document (no "paths").` };
  }

  const { collection: fresh } = importOpenApi(doc as Parameters<typeof importOpenApi>[0]);
  const specs = await readStore<Record<string, SpecRecord>>(STORE_OPENAPI_SPECS, {});

  const state = await readWorkspaceState();
  let collectionId = input.collectionId;
  let existing: Collection | null = null;
  let workspaceId: string;

  if (collectionId) {
    const found = findCollectionAndWorkspace(state, collectionId);
    if (!found) return { error: `No collection with id "${collectionId}" was found.` };
    existing = found.collection;
    workspaceId = found.workspace.id;
  } else {
    const workspace = pickWorkspace(state, input.workspaceId);
    if (!workspace) return { error: 'No workspace exists yet — call kapi_create_workspace first.' };
    workspaceId = workspace.id;
  }

  const previousDoc = collectionId ? (specs[collectionId]?.doc as { paths?: Record<string, unknown> } | undefined) ?? null : null;
  const diff = diffOpenApiSpecs(previousDoc ?? null, doc);

  const merged = existing ? mergeCollectionWithSpec(existing, fresh) : { ...fresh, name: input.name || fresh.name };
  if (!collectionId) collectionId = merged.id;

  const emptyState: WorkspaceStoreState = { workspaces: [], activeWorkspaceId: '' };
  await updateStore(STORE_WORKSPACES, emptyState, (s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w;
      const hasCollection = w.collections.some((c) => c.id === collectionId);
      return { ...w, collections: hasCollection ? w.collections.map((c) => (c.id === collectionId ? merged : c)) : [...w.collections, merged] };
    });
    return { ...s, workspaces };
  });

  const specRecord: SpecRecord = { collectionId: collectionId!, source: label, doc, at: Date.now() };
  await updateStore(STORE_OPENAPI_SPECS, {} as Record<string, SpecRecord>, (s) => ({ ...s, [collectionId!]: specRecord }));

  const historyEntry: OpenApiHistoryEntry = {
    id: uid(),
    collectionId: collectionId!,
    collectionName: merged.name,
    at: Date.now(),
    source: label,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
  };
  await updateStore(STORE_OPENAPI_HISTORY, { entries: [] as OpenApiHistoryEntry[] }, (s) => ({
    entries: [historyEntry, ...s.entries].slice(0, MAX_HISTORY),
  }));

  return { collectionId: collectionId!, collectionName: merged.name, diff, sourceLabel: label };
}
