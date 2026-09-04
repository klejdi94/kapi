import { create } from 'zustand';
import type { RunResult } from '@/types';

/**
 * Responses are deliberately never persisted — they hold live Blobs, and the
 * whole premise of the app is that nothing is stored anywhere but the requests
 * you write. Keyed by tab so switching tabs keeps each result in place.
 */
export interface TabRunState {
  loading: boolean;
  startedAt: number;
  result: RunResult | null;
  controller: AbortController | null;
}

const IDLE: TabRunState = { loading: false, startedAt: 0, result: null, controller: null };

interface ResponseState {
  byTab: Record<string, TabRunState>;
  begin: (tabId: string, controller: AbortController) => void;
  finish: (tabId: string, result: RunResult) => void;
  cancel: (tabId: string) => void;
  clear: (tabId: string) => void;
  setResult: (tabId: string, result: RunResult) => void;
}

export const useResponses = create<ResponseState>()((set, get) => ({
  byTab: {},
  begin: (tabId, controller) =>
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { loading: true, startedAt: performance.now(), result: null, controller } },
    })),
  finish: (tabId, result) =>
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? IDLE), loading: false, controller: null, result } },
    })),
  cancel: (tabId) => {
    get().byTab[tabId]?.controller?.abort();
  },
  clear: (tabId) =>
    set((state) => {
      const next = { ...state.byTab };
      delete next[tabId];
      return { byTab: next };
    }),
  setResult: (tabId, result) =>
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? IDLE), loading: false, result } },
    })),
}));

export function useTabRun(tabId: string): TabRunState {
  return useResponses((s) => s.byTab[tabId] ?? IDLE);
}
