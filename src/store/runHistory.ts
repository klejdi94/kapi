import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RunHistoryEntry } from '@/types';
import { fileJSONStorage } from '@/lib/fileStorage';

const MAX_ENTRIES = 200;

interface RunHistoryState {
  entries: RunHistoryEntry[];
  add: (entry: RunHistoryEntry) => void;
  remove: (id: string) => void;
  clearFor: (collectionId: string) => void;
}

/** Every "Run collection" execution, across all collections — same shape/limits as the per-request `history.ts`. */
export const useRunHistory = create<RunHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) => set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) })),
      remove: (id) => set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
      clearFor: (collectionId) => set((state) => ({ entries: state.entries.filter((e) => e.collectionId !== collectionId) })),
    }),
    { name: 'kapi.run-history', version: 1, storage: createJSONStorage(() => fileJSONStorage) },
  ),
);

/**
 * `useMemo` around the filter, not a `.filter()` inline in the zustand
 * selector — a selector that allocates a new array on every call never
 * settles into a stable snapshot for `useSyncExternalStore` to compare
 * against, which can spiral into "Maximum update depth exceeded" (seen for
 * real in `WorkspaceOverview`'s equivalent workspace-wide selector).
 */
export function useRunHistoryFor(collectionId: string): RunHistoryEntry[] {
  const entries = useRunHistory((s) => s.entries);
  return useMemo(() => entries.filter((e) => e.collectionId === collectionId), [entries, collectionId]);
}
