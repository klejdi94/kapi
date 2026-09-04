import { create } from 'zustand';
import type { WsConnection, WsLogEntry } from '@/lib/ws';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface WsConnState {
  status: WsStatus;
  connection: WsConnection | null;
  log: WsLogEntry[];
  errorMessage: string | null;
}

const IDLE: WsConnState = { status: 'idle', connection: null, log: [], errorMessage: null };
const MAX_LOG = 500;

interface WsConnectionsState {
  byTab: Record<string, WsConnState>;
  setConnecting: (tabId: string) => void;
  setOpen: (tabId: string, connection: WsConnection) => void;
  setClosed: (tabId: string, message?: string) => void;
  setError: (tabId: string, message: string) => void;
  appendLog: (tabId: string, entry: WsLogEntry) => void;
  clearLog: (tabId: string) => void;
}

/**
 * Live connections and their message logs never touch localStorage — same
 * rule as HTTP responses. A socket handle can't be serialized anyway, and a
 * reload should never pretend an old connection is still open.
 */
export const useWsConnections = create<WsConnectionsState>()((set) => ({
  byTab: {},

  setConnecting: (tabId) =>
    set((state) => ({ byTab: { ...state.byTab, [tabId]: { ...IDLE, status: 'connecting' } } })),

  setOpen: (tabId, connection) =>
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? IDLE), status: 'open', connection, errorMessage: null } },
    })),

  setClosed: (tabId, message) =>
    set((state) => ({
      byTab: {
        ...state.byTab,
        [tabId]: { ...(state.byTab[tabId] ?? IDLE), status: 'closed', connection: null, errorMessage: message ?? null },
      },
    })),

  setError: (tabId, message) =>
    set((state) => ({
      byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? IDLE), status: 'error', connection: null, errorMessage: message } },
    })),

  appendLog: (tabId, entry) =>
    set((state) => {
      const current = state.byTab[tabId] ?? IDLE;
      return { byTab: { ...state.byTab, [tabId]: { ...current, log: [...current.log, entry].slice(-MAX_LOG) } } };
    }),

  clearLog: (tabId) =>
    set((state) => ({ byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? IDLE), log: [] } } })),
}));

export function useWsConnState(tabId: string): WsConnState {
  return useWsConnections((s) => s.byTab[tabId] ?? IDLE);
}
