import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileJSONStorage } from '@/lib/fileStorage';
import type { RunStats } from '@/lib/regression';

/** A finished load test, reduced to what's needed to compare the next one against it. */
export interface LoadHistoryEntry {
  id: string;
  collectionId: string;
  /** Folder id, or null for the whole collection. */
  scopeNodeId: string | null;
  at: number;
  virtualUsers: number;
  durationMs: number;
  requests: number;
  throughput: number;
  errorRate: number;
  p95: number;
  stats: RunStats;
}

const MAX_ENTRIES = 100;

export const useLoadHistory = create<{
  entries: LoadHistoryEntry[];
  add: (entry: LoadHistoryEntry) => void;
}>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) => set((s) => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) })),
    }),
    { name: 'kapi.load-history', version: 1, storage: createJSONStorage(() => fileJSONStorage) },
  ),
);

/** The latest load test of the same collection and scope, if any. */
export function previousLoadTest(collectionId: string, scopeNodeId: string | null): LoadHistoryEntry | undefined {
  return useLoadHistory.getState().entries.find((e) => e.collectionId === collectionId && e.scopeNodeId === scopeNodeId);
}
