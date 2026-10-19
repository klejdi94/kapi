import { create } from 'zustand';

export interface MqttLogEntry {
  id: string;
  direction: 'received' | 'sent' | 'system';
  topic?: string;
  text: string;
  qos?: number;
  retain?: boolean;
  bytes?: number;
  at: number;
}

export interface MqttSessionState {
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  /** Topics actually subscribed on the live connection. */
  subscribed: string[];
  log: MqttLogEntry[];
  error: string | null;
}

const IDLE: MqttSessionState = { status: 'idle', subscribed: [], log: [], error: null };
const MAX_LOG = 1000;
let counter = 0;

/** Live MQTT sessions per tab — never persisted, like WebSocket connections. */
export const useMqttSessions = create<{
  byTab: Record<string, MqttSessionState>;
  patch: (tabId: string, patch: Partial<MqttSessionState>) => void;
  append: (tabId: string, entry: Omit<MqttLogEntry, 'id' | 'at'> & { at?: number }) => void;
  clear: (tabId: string) => void;
}>()((set) => ({
  byTab: {},
  patch: (tabId, patch) => set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? IDLE), ...patch } } })),
  append: (tabId, entry) =>
    set((s) => {
      const current = s.byTab[tabId] ?? IDLE;
      const log = [...current.log, { ...entry, id: `mqtt-${Date.now()}-${counter++}`, at: entry.at ?? Date.now() }].slice(-MAX_LOG);
      return { byTab: { ...s.byTab, [tabId]: { ...current, log } } };
    }),
  clear: (tabId) => set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? IDLE), log: [] } } })),
}));

export function useMqttSession(tabId: string): MqttSessionState {
  return useMqttSessions((s) => s.byTab[tabId] ?? IDLE);
}
