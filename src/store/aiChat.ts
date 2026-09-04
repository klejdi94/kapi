import { create } from 'zustand';
import type { ChatTurn } from '@/lib/claudeCli';

interface AiChatState {
  messages: ChatTurn[];
  loading: boolean;
  addMessage: (message: ChatTurn) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

/** Chat history is per-session only — never written to disk. */
export const useAiChat = create<AiChatState>()((set) => ({
  messages: [],
  loading: false,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ messages: [] }),
}));
