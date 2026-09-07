import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { OpenApiHistoryEntry } from '@/types';
import { fileJSONStorage } from '@/lib/fileStorage';

const MAX_ENTRIES = 200;

interface OpenApiHistoryState {
  entries: OpenApiHistoryEntry[];
  add: (entry: OpenApiHistoryEntry) => void;
  remove: (id: string) => void;
  clearFor: (collectionId: string) => void;
}

/** Every "sync with an OpenAPI spec" — across all collections, same shape/limits as `runHistory.ts`. Written by the GUI's own sync action and by the `kapi-mcp` server directly on disk. */
export const useOpenApiHistory = create<OpenApiHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) => set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) })),
      remove: (id) => set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
      clearFor: (collectionId) => set((state) => ({ entries: state.entries.filter((e) => e.collectionId !== collectionId) })),
    }),
    { name: 'kapi.openapi-history', version: 1, storage: createJSONStorage(() => fileJSONStorage) },
  ),
);

/** See the comment on `useRunHistoryFor` in `runHistory.ts` — same fix, same reason. */
export function useOpenApiHistoryFor(collectionId: string): OpenApiHistoryEntry[] {
  const entries = useOpenApiHistory((s) => s.entries);
  return useMemo(() => entries.filter((e) => e.collectionId === collectionId), [entries, collectionId]);
}
