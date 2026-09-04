import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { HistoryEntry, RequestDef } from '@/types';
import { localJSONStorage } from '@/lib/storage';

const MAX_ENTRIES = 200;
/** Bodies are the only unbounded part of a request; cap them before persisting. */
const MAX_PERSISTED_BODY = 20_000;

function trimForStorage(request: RequestDef): RequestDef {
  const clipped = { ...request, body: { ...request.body, text: { ...request.body.text } } };
  for (const key of Object.keys(clipped.body.text) as (keyof typeof clipped.body.text)[]) {
    const value = clipped.body.text[key];
    if (value && value.length > MAX_PERSISTED_BODY) {
      clipped.body.text[key] = `${value.slice(0, MAX_PERSISTED_BODY)}\n… truncated by kapi history …`;
    }
  }
  if (clipped.body.graphql.query.length > MAX_PERSISTED_BODY) {
    clipped.body = { ...clipped.body, graphql: { ...clipped.body.graphql, query: clipped.body.graphql.query.slice(0, MAX_PERSISTED_BODY) } };
  }
  return clipped;
}

interface HistoryState {
  entries: HistoryEntry[];
  add: (entry: HistoryEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) =>
        set((state) => ({
          entries: [{ ...entry, request: trimForStorage(entry.request) }, ...state.entries].slice(0, MAX_ENTRIES),
        })),
      remove: (id) => set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
      clear: () => set({ entries: [] }),
    }),
    { name: 'kapi.history', version: 1, storage: createJSONStorage(() => localJSONStorage) },
  ),
);
