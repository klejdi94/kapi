import { create } from 'zustand';
import type { GrpcCallResult } from '@/lib/grpc';

export interface GrpcReceived {
  json: string;
  atMs: number;
}

export interface GrpcCallState {
  running: boolean;
  callId: string | null;
  headers: [string, string][];
  messages: GrpcReceived[];
  result: GrpcCallResult | null;
  /** A failure before the call produced a gRPC status (bad JSON, no connection…). */
  error: string | null;
}

const EMPTY: GrpcCallState = { running: false, callId: null, headers: [], messages: [], result: null, error: null };

/** The live/last call per tab — never persisted, like HTTP responses. */
export const useGrpcCalls = create<{
  calls: Record<string, GrpcCallState>;
  patch: (tabId: string, patch: Partial<GrpcCallState>) => void;
  addMessage: (tabId: string, message: GrpcReceived) => void;
}>()((set) => ({
  calls: {},
  patch: (tabId, patch) => set((s) => ({ calls: { ...s.calls, [tabId]: { ...(s.calls[tabId] ?? EMPTY), ...patch } } })),
  addMessage: (tabId, message) =>
    set((s) => {
      const current = s.calls[tabId] ?? EMPTY;
      return { calls: { ...s.calls, [tabId]: { ...current, messages: [...current.messages, message] } } };
    }),
}));

export function useGrpcCall(tabId: string): GrpcCallState {
  return useGrpcCalls((s) => s.calls[tabId] ?? EMPTY);
}
