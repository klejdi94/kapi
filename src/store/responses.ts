import { create } from 'zustand';
import type { RunResult } from '@/types';
import type { SseEvent } from '@/lib/sse';

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
  /** Filled live as a `text/event-stream` response arrives — empty for every other response. */
  sseEvents: SseEvent[];
}

const IDLE: TabRunState = { loading: false, startedAt: 0, result: null, controller: null, sseEvents: [] };

interface ResponseState {
  byTab: Record<string, TabRunState>;
  begin: (tabId: string, controller: AbortController) => void;
  finish: (tabId: string, result: RunResult) => void;
  cancel: (tabId: string) => void;
  clear: (tabId: string) => void;
  setResult: (tabId: string, result: RunResult) => void;
  appendSseEvent: (tabId: string, event: SseEvent) => void;
}

export const useResponses = create<ResponseState>()((set, get) => ({
  byTab: {},
  begin: (tabId, controller) =>
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { loading: true, startedAt: performance.now(), result: null, controller, sseEvents: [] } },
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
  appendSseEvent: (tabId, event) =>
    set((state) => {
      const current = state.byTab[tabId] ?? IDLE;
      return { byTab: { ...state.byTab, [tabId]: { ...current, sseEvents: [...current.sseEvents, event] } } };
    }),
}));

export function useTabRun(tabId: string): TabRunState {
  return useResponses((s) => s.byTab[tabId] ?? IDLE);
}
