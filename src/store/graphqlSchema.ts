import { create } from 'zustand';
import type { GraphQLSchemaSummary } from '@/lib/graphqlIntrospection';

interface Entry {
  summary: GraphQLSchemaSummary | null;
  loading: boolean;
  error: string | null;
}

interface GraphQLSchemaState {
  byUrl: Record<string, Entry>;
  setLoading: (url: string) => void;
  setResult: (url: string, summary: GraphQLSchemaSummary) => void;
  setError: (url: string, error: string) => void;
}

const EMPTY: Entry = { summary: null, loading: false, error: null };

/** Keyed by endpoint URL so switching tabs against the same API doesn't refetch. Session-only. */
export const useGraphQLSchema = create<GraphQLSchemaState>()((set) => ({
  byUrl: {},
  setLoading: (url) => set((s) => ({ byUrl: { ...s.byUrl, [url]: { summary: s.byUrl[url]?.summary ?? null, loading: true, error: null } } })),
  setResult: (url, summary) => set((s) => ({ byUrl: { ...s.byUrl, [url]: { summary, loading: false, error: null } } })),
  setError: (url, error) => set((s) => ({ byUrl: { ...s.byUrl, [url]: { summary: s.byUrl[url]?.summary ?? null, loading: false, error } } })),
}));

export function useGraphQLSchemaFor(url: string): Entry {
  return useGraphQLSchema((s) => s.byUrl[url] ?? EMPTY);
}
