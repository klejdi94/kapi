import { create } from 'zustand';
import type { CapturedCall } from '@/lib/discovery';

interface DiscoveryState {
  url: string;
  capturing: boolean;
  raw: CapturedCall[];
  setUrl: (url: string) => void;
  setCapturing: (capturing: boolean) => void;
  addBatch: (entries: CapturedCall[]) => void;
  clear: () => void;
}

/** Session-only — captured traffic is never written to disk on its own; only what the user turns into a collection is. */
export const useDiscovery = create<DiscoveryState>()((set) => ({
  url: '',
  capturing: false,
  raw: [],
  setUrl: (url) => set({ url }),
  setCapturing: (capturing) => set({ capturing }),
  addBatch: (entries) => set((state) => ({ raw: [...state.raw, ...entries] })),
  clear: () => set({ raw: [] }),
}));
