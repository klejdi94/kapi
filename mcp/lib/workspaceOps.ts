import type { Collection, Environment, FolderNode, KV, RequestNode, TreeNode, Workspace } from '@/types';
import { newCollection, newFolder, newRequestNode, newWorkspace, kv, withTrailingBlank } from '@/lib/factory';
import { insertNode, locate, mapNode, allRequests } from '@/lib/tree';
import { readStore, updateStore, STORE_WORKSPACES } from './fileStore.ts';

export interface WorkspaceStoreState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
}

const EMPTY_STATE: WorkspaceStoreState = { workspaces: [], activeWorkspaceId: '' };

export async function readWorkspaceState(): Promise<WorkspaceStoreState> {
  return readStore(STORE_WORKSPACES, EMPTY_STATE);
}

/** Same fallback order the GUI's own `activeWorkspace()` selector uses. */
export function pickWorkspace(state: WorkspaceStoreState, workspaceId?: string): Workspace | null {
  if (workspaceId) return state.workspaces.find((w) => w.id === workspaceId) ?? null;
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? state.workspaces[0] ?? null;
}

export function findCollectionAndWorkspace(
  state: WorkspaceStoreState,
  collectionId: string,
): { workspace: Workspace; collection: Collection } | null {
  for (const workspace of state.workspaces) {
    const collection = workspace.collections.find((c) => c.id === collectionId);
    if (collection) return { workspace, collection };
  }
  return null;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const workspace = newWorkspace(name);
  // Matches the GUI's own `addWorkspace()` (workspaces.ts) exactly: the new
  // workspace always becomes active, unconditionally. Getting this wrong
  // (only setting it active when none existed yet) meant a natural
  // create-workspace-then-create-collection chain with no explicit
  // `workspaceId` silently landed in whatever workspace was already active
  // instead of the one just created — confirmed for real against a live
  // workspace file, not just reasoned about.
  await updateStore(STORE_WORKSPACES, EMPTY_STATE, (state) => ({
    workspaces: [...state.workspaces, workspace],
    activeWorkspaceId: workspace.id,
  }));
  return workspace;
}

export async function createCollection(workspaceId: string | undefined, name: string): Promise<{ workspace: Workspace; collection: Collection } | null> {
  const collection = newCollection(name);
  let result: { workspace: Workspace; collection: Collection } | null = null;
  await updateStore(STORE_WORKSPACES, EMPTY_STATE, (state) => {
    const target = pickWorkspace(state, workspaceId);
    if (!target) return state;
    const workspaces = state.workspaces.map((w) => (w.id === target.id ? { ...w, collections: [...w.collections, collection] } : w));
    result = { workspace: { ...target, collections: [...target.collections, collection] }, collection };
    return { ...state, workspaces };
  });
  return result;
}

export async function createFolder(collectionId: string, parentFolderId: string | null, name: string): Promise<FolderNode | null> {
  const folder = newFolder(name);
  let created: FolderNode | null = null;
  await updateStore(STORE_WORKSPACES, EMPTY_STATE, (state) => {
    const found = findCollectionAndWorkspace(state, collectionId);
    if (!found) return state;
    if (parentFolderId && !locate(found.collection.items, parentFolderId)) return state;
    created = folder;
    const items = insertNode(found.collection.items, parentFolderId, found.collection.items.length, folder);
    return patchCollection(state, collectionId, (c) => ({ ...c, items }));
  });
  return created;
}

export interface CreateRequestInput {
  name: string;
  method: string;
  url: string;
  headers?: { key: string; value: string }[];
  bodyJson?: string;
  description?: string;
}

export async function createRequest(collectionId: string, parentFolderId: string | null, input: CreateRequestInput): Promise<RequestNode | null> {
  const node = newRequestNode(input.name, {
    method: input.method,
    url: input.url,
    headers: input.headers?.length ? withTrailingBlank(input.headers.map((h) => kv({ key: h.key, value: h.value }))) : undefined,
  });
  if (input.description !== undefined) node.description = input.description;
  if (input.bodyJson !== undefined) {
    node.request.body = { ...node.request.body, mode: 'json', text: { ...node.request.body.text, json: input.bodyJson } };
  }
  let created: RequestNode | null = null;
  await updateStore(STORE_WORKSPACES, EMPTY_STATE, (state) => {
    const found = findCollectionAndWorkspace(state, collectionId);
    if (!found) return state;
    if (parentFolderId && !locate(found.collection.items, parentFolderId)) return state;
    created = node;
    const items = insertNode(found.collection.items, parentFolderId, found.collection.items.length, node);
    return patchCollection(state, collectionId, (c) => ({ ...c, items }));
  });
  return created;
}

export async function updateRequest(collectionId: string, nodeId: string, patch: Partial<RequestNode['request']>): Promise<RequestNode | null> {
  let updated: RequestNode | null = null;
  await updateStore(STORE_WORKSPACES, EMPTY_STATE, (state) => {
    const found = findCollectionAndWorkspace(state, collectionId);
    if (!found) return state;
    const located = locate(found.collection.items, nodeId);
    if (!located || located.node.type !== 'request') return state;
    const items = mapNode(found.collection.items, nodeId, (node) => {
      const reqNode = node as RequestNode;
      updated = { ...reqNode, request: { ...reqNode.request, ...patch } };
      return updated;
    });
    return patchCollection(state, collectionId, (c) => ({ ...c, items }));
  });
  return updated;
}

export async function setEnvironmentVariable(
  workspaceId: string | undefined,
  environmentName: string,
  entry: { key: string; value: string; secret?: boolean },
): Promise<Environment | null> {
  let result: Environment | null = null;
  await updateStore(STORE_WORKSPACES, EMPTY_STATE, (state) => {
    const target = pickWorkspace(state, workspaceId);
    if (!target) return state;
    let environment = target.environments.find((e) => e.name === environmentName);
    let environments = target.environments;
    if (!environment) {
      environment = { id: cryptoRandomId(), name: environmentName, variables: [] };
      environments = [...environments, environment];
    }
    const existingRow = environment.variables.find((v) => v.key === entry.key);
    const nextVariables: KV[] = existingRow
      ? environment.variables.map((v) => (v.key === entry.key ? { ...v, value: entry.value, secret: entry.secret ?? v.secret, enabled: true } : v))
      : [...environment.variables, kv({ key: entry.key, value: entry.value, secret: entry.secret })];
    const nextEnvironment: Environment = { ...environment, variables: withTrailingBlank(nextVariables) };
    environments = environments.map((e) => (e.id === nextEnvironment.id ? nextEnvironment : e));
    result = nextEnvironment;
    const workspaces = state.workspaces.map((w) => (w.id === target.id ? { ...w, environments } : w));
    return { ...state, workspaces };
  });
  return result;
}

function patchCollection(state: WorkspaceStoreState, collectionId: string, fn: (c: Collection) => Collection): WorkspaceStoreState {
  return {
    ...state,
    workspaces: state.workspaces.map((w) => ({
      ...w,
      collections: w.collections.map((c) => (c.id === collectionId ? fn(c) : c)),
    })),
  };
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

export function summarizeTree(items: TreeNode[]): unknown[] {
  return items.map((node) => {
    if (node.type === 'folder') return { type: 'folder', id: node.id, name: node.name, items: summarizeTree(node.items) };
    if (node.type === 'request') return { type: 'request', id: node.id, name: node.name, method: node.request.method, url: node.request.url };
    return { type: 'websocket', id: node.id, name: node.name, url: node.request.url };
  });
}

export { allRequests };
