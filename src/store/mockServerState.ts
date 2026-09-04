import { create } from 'zustand';
import type { MockHit } from '@/lib/mock';

const MAX_HITS = 200;

interface MockServerState {
  running: boolean;
  port: number | null;
  hits: MockHit[];
  setRunning: (running: boolean, port?: number | null) => void;
  addHit: (hit: MockHit) => void;
  clearHits: () => void;
}

/** Never persisted — a running server is a live process, not durable state. */
export const useMockServerState = create<MockServerState>()((set) => ({
  running: false,
  port: null,
  hits: [],
  setRunning: (running, port = null) => set({ running, port: running ? port : null }),
  addHit: (hit) => set((state) => ({ hits: [hit, ...state.hits].slice(0, MAX_HITS) })),
  clearHits: () => set({ hits: [] }),
}));
