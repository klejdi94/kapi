import { KVEditor } from '@/components/ui/KVEditor';
import type { KV } from '@/types';

export function HeadersTab({
  headers,
  autoHeaders,
  onChange,
  resolve,
}: {
  headers: KV[];
  autoHeaders: { key: string; value: string }[];
  onChange: (rows: KV[]) => void;
  resolve: (text: string) => string;
}) {
  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="overflow-hidden rounded-md border border-line">
        <KVEditor rows={headers} onChange={onChange} showDescription resolve={resolve} />
      </div>

      {autoHeaders.length > 0 && (
        <section>
          <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
            Auto-generated ({autoHeaders.length})
          </h3>
          <div className="overflow-hidden rounded-md border border-line opacity-60">
            <div className="grid grid-cols-2 gap-px bg-line">
              {autoHeaders.map((h) => (
                <div key={h.key} className="contents">
                  <div className="bg-surface px-2.5 py-1.5 font-mono text-[12px] text-dim">{h.key}</div>
                  <div className="truncate bg-surface px-2.5 py-1.5 font-mono text-[12px] text-faint">{h.value}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-faint">
            Added automatically from auth and body settings. Add a header with the same name above to override one.
          </p>
        </section>
      )}
    </div>
  );
}
