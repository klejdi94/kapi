#!/usr/bin/env -S npx tsx
/**
 * kapi's MCP server — lets an AI CLI (Claude Code, Codex, Gemini) read and
 * enrich a kapi workspace: create collections/requests, run test batteries,
 * and keep a collection's OpenAPI-derived requests in sync with a backend's
 * real spec over time. Talks stdio (see `mcp:install` / the README) so it
 * needs neither kapi installed nor its window open — it operates directly
 * on the same JSON files the desktop app itself persists to (see
 * `src/lib/fileStorage.ts`), and never touches credentials for the AI CLI
 * that's running it.
 *
 * Usage: registered once via `npm run mcp:install`, then invoked by the AI
 * CLI itself — not meant to be run by hand except to sanity-check startup.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { setScriptSandbox } from '@/lib/scripting';
import { KAPI_VERSION } from '@/version';
import { nodeSandbox } from '@/lib/scripting/nodeSandbox';
import { dataDir, findAppInstall, KAPI_RELEASES_URL } from './lib/dataDir.ts';
import { RELOAD_HINT } from './lib/fileStore.ts';
import {
  createCollection,
  createFolder,
  createRequest,
  createWorkspace,
  findCollectionAndWorkspace,
  pickWorkspace,
  readWorkspaceState,
  setEnvironmentVariable,
  summarizeTree,
  updateRequest,
} from './lib/workspaceOps.ts';
import { runTests } from './lib/runTests.ts';
import { syncOpenApi } from './lib/openapiSync.ts';

// Collection scripts may come from anyone who shared the collection — they run
// in an isolated vm context, never with this process's own Node APIs.
setScriptSandbox(nodeSandbox);

const server = new McpServer({ name: 'kapi', version: KAPI_VERSION });

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

server.registerTool(
  'kapi_status',
  {
    title: 'kapi status',
    description:
      'Reports what kapi data exists on this machine — workspaces, collections, whether the kapi app itself is installed. Call this first: if there is no workspace yet, it tells you exactly what to call next instead of failing.',
    inputSchema: {},
  },
  async () => {
    const state = await readWorkspaceState();
    const appPath = findAppInstall();
    const lines: string[] = [];
    lines.push(`Data directory: ${dataDir()}`);
    if (!state.workspaces.length) {
      lines.push('No workspace exists yet.');
      lines.push('Next step: call kapi_create_workspace with a name, e.g. { "name": "My API" }.');
    } else {
      lines.push(`${state.workspaces.length} workspace(s):`);
      for (const ws of state.workspaces) {
        const active = ws.id === state.activeWorkspaceId ? ' (active)' : '';
        lines.push(`  - ${ws.name}${active} — id ${ws.id} — ${ws.collections.length} collection(s), ${ws.environments.length} environment(s)`);
      }
    }
    lines.push(appPath ? `kapi app found at ${appPath}.` : `kapi app not found on this machine — download it from ${KAPI_RELEASES_URL} to see this workspace visually (not required for these tools to work).`);
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'kapi_list_workspaces',
  { title: 'List workspaces', description: 'Lists every kapi workspace on this machine, with their collection and environment counts.', inputSchema: {} },
  async () => {
    const state = await readWorkspaceState();
    return text(state.workspaces.map((w) => ({ id: w.id, name: w.name, active: w.id === state.activeWorkspaceId, collections: w.collections.length, environments: w.environments.length })));
  },
);

server.registerTool(
  'kapi_create_workspace',
  { title: 'Create workspace', description: 'Creates a new, empty kapi workspace. Use this when kapi_status reports none exist yet.', inputSchema: { name: z.string().describe('Workspace name, e.g. "My API"') } },
  async ({ name }) => {
    const ws = await createWorkspace(name);
    return text(`Created workspace "${ws.name}" (id ${ws.id}). ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_list_collections',
  {
    title: 'List collections',
    description: 'Lists the collections in a workspace (or the active one if workspaceId is omitted).',
    inputSchema: { workspaceId: z.string().optional().describe('Omit to use the active workspace') },
  },
  async ({ workspaceId }) => {
    const state = await readWorkspaceState();
    const ws = pickWorkspace(state, workspaceId);
    if (!ws) return errorText('No workspace found. Call kapi_create_workspace first.');
    return text(ws.collections.map((c) => ({ id: c.id, name: c.name, requests: summarizeTree(c.items).length })));
  },
);

server.registerTool(
  'kapi_create_collection',
  {
    title: 'Create collection',
    description: 'Creates a new, empty collection inside a workspace.',
    inputSchema: { workspaceId: z.string().optional().describe('Omit to use the active workspace'), name: z.string() },
  },
  async ({ workspaceId, name }) => {
    const result = await createCollection(workspaceId, name);
    if (!result) return errorText('No workspace found. Call kapi_create_workspace first.');
    return text(`Created collection "${result.collection.name}" (id ${result.collection.id}) in workspace "${result.workspace.name}". ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_get_collection',
  {
    title: 'Get collection tree',
    description: 'Returns the full folder/request tree of a collection, so you can see what already exists before adding to it.',
    inputSchema: { collectionId: z.string() },
  },
  async ({ collectionId }) => {
    const state = await readWorkspaceState();
    const found = findCollectionAndWorkspace(state, collectionId);
    if (!found) return errorText(`No collection with id "${collectionId}" was found. Call kapi_list_collections to see what exists.`);
    return text({ id: found.collection.id, name: found.collection.name, description: found.collection.description, items: summarizeTree(found.collection.items) });
  },
);

server.registerTool(
  'kapi_create_folder',
  {
    title: 'Create folder',
    description: 'Creates a folder inside a collection, optionally nested inside another folder.',
    inputSchema: { collectionId: z.string(), parentFolderId: z.string().optional(), name: z.string() },
  },
  async ({ collectionId, parentFolderId, name }) => {
    const folder = await createFolder(collectionId, parentFolderId ?? null, name);
    if (!folder) return errorText('Collection or parent folder not found.');
    return text(`Created folder "${folder.name}" (id ${folder.id}). ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_create_request',
  {
    title: 'Create request',
    description: 'Adds a new HTTP request to a collection. Use {{variable}} in the URL for anything environment-specific — never a real secret.',
    inputSchema: {
      collectionId: z.string(),
      parentFolderId: z.string().optional().describe('Omit to add at the top level of the collection'),
      name: z.string(),
      method: z.string().describe('GET, POST, PUT, PATCH, DELETE, etc.'),
      url: z.string(),
      headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
      bodyJson: z.string().optional().describe('A JSON body as a string, if this request sends one'),
      description: z.string().optional().describe('Markdown notes shown in kapi\'s Docs tab'),
    },
  },
  async ({ collectionId, parentFolderId, name, method, url, headers, bodyJson, description }) => {
    const node = await createRequest(collectionId, parentFolderId ?? null, { name, method, url, headers, bodyJson, description });
    if (!node) return errorText('Collection or parent folder not found.');
    return text(`Created request "${node.name}" (id ${node.id}). ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_update_request',
  {
    title: 'Update request',
    description: 'Updates fields of an existing request (method, url, headers as key/value pairs, or a JSON body).',
    inputSchema: {
      collectionId: z.string(),
      nodeId: z.string(),
      method: z.string().optional(),
      url: z.string().optional(),
      headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
      bodyJson: z.string().optional(),
    },
  },
  async ({ collectionId, nodeId, method, url, headers, bodyJson }) => {
    const patch: Record<string, unknown> = {};
    if (method !== undefined) patch.method = method;
    if (url !== undefined) patch.url = url;
    if (headers !== undefined) patch.headers = headers.map((h) => ({ id: cryptoId(), key: h.key, value: h.value, enabled: true }));
    let updated = await updateRequest(collectionId, nodeId, patch as never);
    if (!updated) return errorText('Request not found.');
    if (bodyJson !== undefined) {
      updated = await updateRequest(collectionId, nodeId, {
        body: { ...updated.request.body, mode: 'json', text: { ...updated.request.body.text, json: bodyJson } },
      } as never);
    }
    return text(`Updated request "${updated!.name}". ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_set_environment_variable',
  {
    title: 'Set environment variable',
    description: 'Sets (or adds) one variable in a named environment, creating the environment if it does not exist yet. Mark real credentials as secret so kapi masks and never sends them to its own AI panel.',
    inputSchema: {
      workspaceId: z.string().optional(),
      environmentName: z.string(),
      key: z.string(),
      value: z.string(),
      secret: z.boolean().optional(),
    },
  },
  async ({ workspaceId, environmentName, key, value, secret }) => {
    const env = await setEnvironmentVariable(workspaceId, environmentName, { key, value, secret });
    if (!env) return errorText('No workspace found. Call kapi_create_workspace first.');
    return text(`Set ${key} in environment "${environmentName}". ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_run_tests',
  {
    title: 'Run a test battery',
    description: 'Runs every request in a collection (or one folder in it) through the same pre-request → send → test pipeline the GUI uses, and records the run in kapi\'s own run history.',
    inputSchema: {
      collectionId: z.string(),
      scope: z.string().optional().describe('A folder name or id to run just that folder, omit for the whole collection'),
      environmentName: z.string().optional(),
      iterations: z.number().int().positive().optional(),
      delayMs: z.number().int().nonnegative().optional(),
    },
  },
  async (input) => {
    const result = await runTests(input);
    if ('error' in result) return errorText(result.error);
    const summary = `${result.collectionName}${result.scopeName ? ` / ${result.scopeName}` : ''}: ${result.passed} passed, ${result.failed} failed, ${result.errored} errored, in ${result.durationMs}ms.`;
    return text(`${summary}${result.warning ? `\nWarning: ${result.warning}` : ''}\n${RELOAD_HINT}\n\n${JSON.stringify(result.results, null, 2)}`);
  },
);

server.registerTool(
  'kapi_import_openapi',
  {
    title: 'Import an OpenAPI/Swagger spec',
    description: 'Imports an OpenAPI or Swagger spec as a brand-new collection. Use kapi_sync_openapi instead once a collection already exists for this backend, so re-running it updates instead of duplicating.',
    inputSchema: {
      workspaceId: z.string().optional(),
      name: z.string().optional().describe('Collection name; defaults to the spec\'s own title'),
      url: z.string().optional(),
      filePath: z.string().optional(),
      probeOrigin: z.string().optional().describe('e.g. http://localhost:3000 — tries the common spec paths (/openapi.json, /v3/api-docs, ...) automatically'),
    },
  },
  async ({ workspaceId, name, url, filePath, probeOrigin }) => {
    const source = sourceFrom({ url, filePath, probeOrigin });
    if (!source) return errorText('Provide one of: url, filePath, or probeOrigin.');
    const result = await syncOpenApi({ workspaceId, name, source });
    if ('error' in result) return errorText(result.error);
    return text(`Imported "${result.collectionName}" (id ${result.collectionId}) from ${result.sourceLabel} — ${result.diff.added.length} endpoint(s). ${RELOAD_HINT}`);
  },
);

server.registerTool(
  'kapi_sync_openapi',
  {
    title: 'Sync a collection with its OpenAPI/Swagger spec',
    description:
      'Re-fetches a backend\'s OpenAPI/Swagger spec and merges the changes into an existing collection: matched endpoints keep their auth, scripts, saved examples and body — only params/headers are refreshed from the spec; brand-new endpoints are added; endpoints removed from the spec are left alone, never deleted. Records what changed in kapi\'s OpenAPI history. Call this whenever a backend project you\'re working on starts up or its spec changes.',
    inputSchema: {
      collectionId: z.string(),
      url: z.string().optional(),
      filePath: z.string().optional(),
      probeOrigin: z.string().optional().describe('e.g. http://localhost:3000 — tries the common spec paths automatically'),
    },
  },
  async ({ collectionId, url, filePath, probeOrigin }) => {
    const source = sourceFrom({ url, filePath, probeOrigin });
    if (!source) return errorText('Provide one of: url, filePath, or probeOrigin.');
    const result = await syncOpenApi({ collectionId, source });
    if ('error' in result) return errorText(result.error);
    const { diff } = result;
    const lines = [
      `Synced "${result.collectionName}" from ${result.sourceLabel}.`,
      `Added: ${diff.added.length ? diff.added.join(', ') : 'none'}`,
      `Changed: ${diff.changed.length ? diff.changed.join(', ') : 'none'}`,
      `Removed from spec (left untouched in kapi): ${diff.removed.length ? diff.removed.join(', ') : 'none'}`,
      RELOAD_HINT,
    ];
    return text(lines.join('\n'));
  },
);

function sourceFrom(opts: { url?: string; filePath?: string; probeOrigin?: string }) {
  if (opts.url) return { kind: 'url' as const, value: opts.url };
  if (opts.filePath) return { kind: 'file' as const, value: opts.filePath };
  if (opts.probeOrigin) return { kind: 'probe' as const, value: opts.probeOrigin };
  return null;
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 12);
}

const transport = new StdioServerTransport();
await server.connect(transport);
