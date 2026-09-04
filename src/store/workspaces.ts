import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Collection, Environment, KV, RequestDef, TreeNode, Workspace } from '@/types';
import { newCollection, newEnvironment, newWorkspace, seedWorkspace, uid, kv } from '@/lib/factory';
import { insertNode, locate, mapNode, reidentify, removeNode } from '@/lib/tree';
import { localJSONStorage } from '@/lib/storage';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;

  /* workspaces */
  addWorkspace: (name?: string) => string;
  importWorkspace: (workspace: Workspace) => string;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;

  /* collections */
  addCollection: (name?: string) => string;
  importCollection: (collection: Collection) => string;
  updateCollection: (id: string, patch: Partial<Collection>) => void;
  deleteCollection: (id: string) => Collection | null;
  restoreCollection: (collection: Collection, index: number) => void;

  /* tree nodes */
  addNode: (collectionId: string, parentFolderId: string | null, node: TreeNode) => void;
  updateNode: (collectionId: string, nodeId: string, patch: Partial<TreeNode>) => void;
  updateRequest: (collectionId: string, nodeId: string, request: RequestDef) => void;
  deleteNode: (collectionId: string, nodeId: string) => { node: TreeNode; parentId: string | null; index: number } | null;
  duplicateNode: (collectionId: string, nodeId: string) => void;
  moveNode: (
    from: { collectionId: string; nodeId: string },
    to: { collectionId: string; parentFolderId: string | null; index: number },
  ) => void;

  /* environments */
  addEnvironment: (name?: string) => string;
  importEnvironment: (environment: Environment) => string;
  updateEnvironment: (id: string, patch: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnvironment: (id: string | null) => void;
  setGlobals: (variables: KV[]) => void;

  /* git */
  setGitRepoPath: (path: string | null) => void;
  replaceCollections: (collections: Collection[]) => void;
}

const touch = (ws: Workspace): Workspace => ({ ...ws, updatedAt: Date.now() });

export const useWorkspaces = create<WorkspaceState>()(
  persist(
    (set, get) => {
      /** Applies `fn` to the active workspace; every mutation funnels through here. */
      const patchActive = (fn: (ws: Workspace) => Workspace) =>
        set((state) => ({
          workspaces: state.workspaces.map((ws) => (ws.id === state.activeWorkspaceId ? touch(fn(ws)) : ws)),
        }));

      const patchCollection = (collectionId: string, fn: (c: Collection) => Collection) =>
        patchActive((ws) => ({
          ...ws,
          collections: ws.collections.map((c) => (c.id === collectionId ? fn(c) : c)),
        }));

      return {
        workspaces: [],
        activeWorkspaceId: '',

        addWorkspace: (name) => {
          const ws = newWorkspace(name || 'New workspace');
          set((state) => ({ workspaces: [...state.workspaces, ws], activeWorkspaceId: ws.id }));
          return ws.id;
        },

        importWorkspace: (workspace) => {
          set((state) => ({ workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id }));
          return workspace.id;
        },

        renameWorkspace: (id, name) =>
          set((state) => ({
            workspaces: state.workspaces.map((ws) => (ws.id === id ? touch({ ...ws, name }) : ws)),
          })),

        deleteWorkspace: (id) =>
          set((state) => {
            const remaining = state.workspaces.filter((ws) => ws.id !== id);
            // Never leave the app with nothing to show.
            const next = remaining.length ? remaining : [seedWorkspace()];
            const activeStillExists = next.some((ws) => ws.id === state.activeWorkspaceId);
            return {
              workspaces: next,
              activeWorkspaceId: activeStillExists ? state.activeWorkspaceId : next[0].id,
            };
          }),

        setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

        addCollection: (name) => {
          const collection = newCollection(name || 'New collection');
          patchActive((ws) => ({ ...ws, collections: [...ws.collections, collection] }));
          return collection.id;
        },

        importCollection: (collection) => {
          patchActive((ws) => ({ ...ws, collections: [...ws.collections, collection] }));
          return collection.id;
        },

        updateCollection: (id, patch) => patchCollection(id, (c) => ({ ...c, ...patch })),

        deleteCollection: (id) => {
          const ws = get().workspaces.find((w) => w.id === get().activeWorkspaceId);
          const existing = ws?.collections.find((c) => c.id === id) ?? null;
          patchActive((w) => ({ ...w, collections: w.collections.filter((c) => c.id !== id) }));
          return existing;
        },

        restoreCollection: (collection, index) =>
          patchActive((ws) => {
            const collections = [...ws.collections];
            collections.splice(Math.min(index, collections.length), 0, collection);
            return { ...ws, collections };
          }),

        addNode: (collectionId, parentFolderId, node) =>
          patchCollection(collectionId, (c) => ({
            ...c,
            items: insertNode(c.items, parentFolderId, Number.MAX_SAFE_INTEGER, node),
          })),

        updateNode: (collectionId, nodeId, patch) =>
          patchCollection(collectionId, (c) => ({
            ...c,
            items: mapNode(c.items, nodeId, (node) => ({ ...node, ...patch }) as TreeNode),
          })),

        updateRequest: (collectionId, nodeId, request) =>
          patchCollection(collectionId, (c) => ({
            ...c,
            items: mapNode(c.items, nodeId, (node) => (node.type === 'request' ? { ...node, request } : node)),
          })),

        deleteNode: (collectionId, nodeId) => {
          const ws = get().workspaces.find((w) => w.id === get().activeWorkspaceId);
          const collection = ws?.collections.find((c) => c.id === collectionId);
          if (!collection) return null;
          const found = locate(collection.items, nodeId);
          if (!found) return null;
          patchCollection(collectionId, (c) => ({ ...c, items: removeNode(c.items, nodeId) }));
          return { node: found.node, parentId: found.parent?.id ?? null, index: found.index };
        },

        duplicateNode: (collectionId, nodeId) =>
          patchCollection(collectionId, (c) => {
            const found = locate(c.items, nodeId);
            if (!found) return c;
            const copy = reidentify(found.node, uid);
            copy.name = `${found.node.name} copy`;
            return { ...c, items: insertNode(c.items, found.parent?.id ?? null, found.index + 1, copy) };
          }),

        moveNode: (from, to) => {
          const ws = get().workspaces.find((w) => w.id === get().activeWorkspaceId);
          const source = ws?.collections.find((c) => c.id === from.collectionId);
          if (!source) return;
          const found = locate(source.items, from.nodeId);
          if (!found) return;
          const moving = found.node;

          patchActive((w) => ({
            ...w,
            collections: w.collections.map((c) => {
              if (c.id !== from.collectionId && c.id !== to.collectionId) return c;
              let items = c.items;
              if (c.id === from.collectionId) items = removeNode(items, from.nodeId);
              if (c.id === to.collectionId) {
                // Removing first can shift the target index within the same list.
                const sameList =
                  from.collectionId === to.collectionId &&
                  (found.parent?.id ?? null) === to.parentFolderId &&
                  found.index < to.index;
                items = insertNode(items, to.parentFolderId, sameList ? to.index - 1 : to.index, moving);
              }
              return { ...c, items };
            }),
          }));
        },

        addEnvironment: (name) => {
          const env = newEnvironment(name || 'New environment');
          patchActive((ws) => ({
            ...ws,
            environments: [...ws.environments, env],
            activeEnvironmentId: ws.activeEnvironmentId ?? env.id,
          }));
          return env.id;
        },

        importEnvironment: (environment) => {
          patchActive((ws) => ({ ...ws, environments: [...ws.environments, environment] }));
          return environment.id;
        },

        updateEnvironment: (id, patch) =>
          patchActive((ws) => ({
            ...ws,
            environments: ws.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
          })),

        deleteEnvironment: (id) =>
          patchActive((ws) => ({
            ...ws,
            environments: ws.environments.filter((e) => e.id !== id),
            activeEnvironmentId: ws.activeEnvironmentId === id ? null : ws.activeEnvironmentId,
          })),

        setActiveEnvironment: (id) => patchActive((ws) => ({ ...ws, activeEnvironmentId: id })),

        setGlobals: (variables) => patchActive((ws) => ({ ...ws, globals: variables })),

        setGitRepoPath: (path) => patchActive((ws) => ({ ...ws, gitRepoPath: path })),
        replaceCollections: (collections) => patchActive((ws) => ({ ...ws, collections })),
      };
    },
    {
      name: 'kapi.workspaces',
      version: 1,
      storage: createJSONStorage(() => localJSONStorage),
      onRehydrateStorage: () => (state) => {
        // First visit, or storage was cleared: give them something to play with.
        if (!state) return;
        if (!state.workspaces.length) {
          const seeded = seedWorkspace();
          state.workspaces = [seeded];
          state.activeWorkspaceId = seeded.id;
        } else {
          // Backfill fields added after some workspaces were already persisted.
          state.workspaces = state.workspaces.map((ws) => ({ ...ws, gitRepoPath: ws.gitRepoPath ?? null }));
          if (!state.workspaces.some((ws) => ws.id === state.activeWorkspaceId)) {
            state.activeWorkspaceId = state.workspaces[0].id;
          }
        }
      },
    },
  ),
);

/* ------------------------------------------------------------- selectors */

/** Stable identity matters: zustand re-renders on reference change, so the
 *  pre-hydration fallback must be a singleton rather than a fresh object. */
const EMPTY_WORKSPACE: Workspace = { ...newWorkspace('Workspace'), id: '', globals: [kv({ enabled: false })] };

export function activeWorkspace(state: WorkspaceState): Workspace {
  return state.workspaces.find((ws) => ws.id === state.activeWorkspaceId) ?? state.workspaces[0] ?? EMPTY_WORKSPACE;
}

export function useActiveWorkspace(): Workspace {
  return useWorkspaces(activeWorkspace);
}

export function findCollection(ws: Workspace, id: string | null): Collection | null {
  if (!id) return null;
  return ws.collections.find((c) => c.id === id) ?? null;
}
