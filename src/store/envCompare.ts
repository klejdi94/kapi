import { create } from 'zustand';

/** Whether the "compare across environments" dialog is open for the active tab. */
export const useEnvCompare = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
