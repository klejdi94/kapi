import { create } from 'zustand';
import type { RunnerResult } from '@/lib/runner';

interface RunnerState {
  open: boolean;
  collectionId: string | null;
  scopeNodeId: string | null;
  running: boolean;
  results: RunnerResult[];
  controller: AbortController | null;
  openFor: (collectionId: string, scopeNodeId: string | null) => void;
  close: () => void;
  start: (controller: AbortController) => void;
  addResult: (result: RunnerResult) => void;
  stop: () => void;
  finish: () => void;
}

/** Ephemeral run state — never persisted, cleared each time a new run starts. */
export const useRunner = create<RunnerState>()((set, get) => ({
  open: false,
  collectionId: null,
  scopeNodeId: null,
  running: false,
  results: [],
  controller: null,
  openFor: (collectionId, scopeNodeId) => set({ open: true, collectionId, scopeNodeId, results: [] }),
  close: () => {
    get().controller?.abort();
    set({ open: false, running: false, controller: null });
  },
  start: (controller) => set({ running: true, results: [], controller }),
  addResult: (result) => set((state) => ({ results: [...state.results, result] })),
  stop: () => {
    get().controller?.abort();
    set({ running: false, controller: null });
  },
  finish: () => set({ running: false, controller: null }),
}));
