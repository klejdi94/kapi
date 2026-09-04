import { create } from 'zustand';
import type { TestResult } from '@/lib/scripting';

interface TestResultsState {
  byTab: Record<string, TestResult[]>;
  setResults: (tabId: string, results: TestResult[]) => void;
  clear: (tabId: string) => void;
}

/** Ephemeral — test results belong to the response they came from, never persisted. */
export const useTestResults = create<TestResultsState>()((set) => ({
  byTab: {},
  setResults: (tabId, results) => set((state) => ({ byTab: { ...state.byTab, [tabId]: results } })),
  clear: (tabId) =>
    set((state) => {
      const next = { ...state.byTab };
      delete next[tabId];
      return { byTab: next };
    }),
}));

export function useTabTestResults(tabId: string): TestResult[] {
  return useTestResults((s) => s.byTab[tabId] ?? []);
}
