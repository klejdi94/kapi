import { create } from 'zustand';

interface TokenInspectorState {
  open: boolean;
  initialValue: string;
  openWith: (value?: string) => void;
  close: () => void;
}

export const useTokenInspector = create<TokenInspectorState>()((set) => ({
  open: false,
  initialValue: '',
  openWith: (value = '') => set({ open: true, initialValue: value }),
  close: () => set({ open: false }),
}));
