import { create } from 'zustand';
import { uid } from '@/lib/factory';

export type ConsoleKind =
  | 'http-request'
  | 'http-response'
  | 'http-error'
  | 'ws-connect'
  | 'ws-send'
  | 'ws-receive'
  | 'ws-close'
  | 'mock-hit'
  | 'script'
  | 'script-error';

export interface ConsoleEntry {
  id: string;
  at: number;
  kind: ConsoleKind;
  /** One-line summary shown in the collapsed row, e.g. "GET https://api.example.com/users → 200 · 214ms". */
  summary: string;
  /** Full detail (headers, body, error message…) shown when the row is expanded. */
  detail: string;
  tabName?: string;
}

const MAX_ENTRIES = 1000;

interface ConsoleState {
  entries: ConsoleEntry[];
  open: boolean;
  setOpen: (open: boolean) => void;
  log: (entry: Omit<ConsoleEntry, 'id' | 'at'>) => void;
  clear: () => void;
}

/**
 * A running wire-level log across the whole app session — every HTTP call,
 * WebSocket frame and mock-server hit — independent of History (which only
 * tracks HTTP sends against saved requests). Never persisted: it's a debug
 * aid for the current session, not durable data.
 */
export const useConsole = create<ConsoleState>()((set) => ({
  entries: [],
  open: false,
  setOpen: (open) => set({ open }),
  log: (entry) =>
    set((state) => ({
      entries: [{ ...entry, id: uid(), at: Date.now() }, ...state.entries].slice(0, MAX_ENTRIES),
    })),
  clear: () => set({ entries: [] }),
}));
