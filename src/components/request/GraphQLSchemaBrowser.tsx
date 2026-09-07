import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import type { GraphQLFieldSummary, GraphQLSchemaSummary } from '@/lib/graphqlIntrospection';
import { buildSkeletonQuery } from '@/lib/graphqlIntrospection';

function FieldRow({
  field,
  kind,
  schema,
  onInsert,
}: {
  field: GraphQLFieldSummary;
  kind: 'query' | 'mutation';
  schema: GraphQLSchemaSummary;
  onInsert: (skeleton: string) => void;
}) {
  return (
    <button
      onClick={() => onInsert(buildSkeletonQuery(field, kind, schema))}
      title={field.description ?? undefined}
      className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-surface-3"
    >
      <span className="font-mono text-[11.5px] text-fg">{field.name}</span>
      <span className="truncate text-[10px] text-faint">{field.returnType}</span>
    </button>
  );
}

/** Lists the queries/mutations from a fetched introspection result; clicking one inserts a starter selection into the query editor. */
export function GraphQLSchemaBrowser({
  schema,
  loading,
  error,
  onFetch,
  onInsert,
}: {
  schema: GraphQLSchemaSummary | null;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
  onInsert: (skeleton: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden bg-surface-2">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-faint">Schema</span>
        <button onClick={onFetch} disabled={loading} title="Fetch schema" className="text-faint hover:text-fg disabled:opacity-40">
          <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && <div className="p-2 text-[11px] text-faint">Fetching schema…</div>}
        {!loading && error && (
          <div className="flex flex-col gap-1.5 p-2">
            <div className="flex items-center gap-1.5 text-[11px] text-warn">
              <AlertTriangle size={12} /> Couldn't fetch schema
            </div>
            <p className="text-[10.5px] leading-relaxed text-faint">{error}</p>
            <Button size="sm" onClick={onFetch}>
              Try again
            </Button>
          </div>
        )}
        {!loading && !error && !schema && (
          <div className="flex flex-col gap-1.5 p-2">
            <p className="text-[11px] leading-relaxed text-faint">Fetch the schema to browse available queries and mutations.</p>
            <Button size="sm" variant="primary" onClick={onFetch}>
              Fetch schema
            </Button>
          </div>
        )}
        {!loading && schema && (
          <>
            {schema.queries.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Queries</div>
                {schema.queries.map((f) => (
                  <FieldRow key={f.name} field={f} kind="query" schema={schema} onInsert={onInsert} />
                ))}
              </div>
            )}
            {schema.mutations.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Mutations</div>
                {schema.mutations.map((f) => (
                  <FieldRow key={f.name} field={f} kind="mutation" schema={schema} onInsert={onInsert} />
                ))}
              </div>
            )}
            {schema.queries.length === 0 && schema.mutations.length === 0 && <p className="p-2 text-[11px] text-faint">No queries or mutations found.</p>}
          </>
        )}
      </div>
    </div>
  );
}
