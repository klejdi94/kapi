import { KVEditor } from '@/components/ui/KVEditor';
import type { KV } from '@/types';

export function ParamsTab({
  params,
  pathVars,
  onParams,
  onPathVars,
  resolve,
}: {
  params: KV[];
  pathVars: KV[];
  onParams: (rows: KV[]) => void;
  onPathVars: (rows: KV[]) => void;
  resolve: (text: string) => string;
}) {
  return (
    <div className="flex flex-col gap-5 p-3">
      <section>
        <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Query params</h3>
        <div className="overflow-hidden rounded-md border border-line">
          <KVEditor rows={params} onChange={onParams} showDescription resolve={resolve} />
        </div>
      </section>

      {pathVars.length > 0 && (
        <section>
          <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
            Path variables
          </h3>
          <div className="overflow-hidden rounded-md border border-line">
            <KVEditor
              rows={pathVars.map((r) => ({ ...r, enabled: true }))}
              onChange={(rows) => onPathVars(rows.map((r) => ({ ...r, enabled: true })))}
              keyPlaceholder="name"
              resolve={resolve}
            />
          </div>
          <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-faint">
            Detected from <code className="text-dim">:name</code> segments in the URL.
          </p>
        </section>
      )}
    </div>
  );
}
