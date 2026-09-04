import { KVEditor } from '@/components/ui/KVEditor';
import { Input } from '@/components/ui/primitives';
import type { KV } from '@/types';

export interface UrlVariable {
  name: string;
  value: string;
  /** Where the value came from, or null when nothing defines it. */
  source: string | null;
  /** Generated per-send (`{{$guid}}`); defining a real variable would shadow it. */
  dynamic: boolean;
}

export function ParamsTab({
  params,
  pathVars,
  urlVariables,
  onParams,
  onPathVars,
  onSetVariable,
  resolve,
}: {
  params: KV[];
  pathVars: KV[];
  urlVariables: UrlVariable[];
  onParams: (rows: KV[]) => void;
  onPathVars: (rows: KV[]) => void;
  onSetVariable: (name: string, value: string) => void;
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
        <section className="animate-in">
          <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Path variables</h3>
          <div className="overflow-hidden rounded-md border border-line">
            <KVEditor
              rows={pathVars.map((r) => ({ ...r, enabled: true }))}
              onChange={(rows) => onPathVars(rows.map((r) => ({ ...r, enabled: true })))}
              keyPlaceholder="name"
              resolve={resolve}
            />
          </div>
          <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-faint">
            Detected from <code className="text-dim">:name</code> segments. The value is stored on this request.
          </p>
        </section>
      )}

      {urlVariables.length > 0 && (
        <section className="animate-in">
          <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">URL variables</h3>
          <div className="overflow-hidden rounded-md border border-line">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-px bg-line text-[12px]">
              <HeaderCell>Variable</HeaderCell>
              <HeaderCell>Value</HeaderCell>
              <HeaderCell>Source</HeaderCell>
              {urlVariables.map((variable) => (
                <UrlVariableRow key={variable.name} variable={variable} onSetVariable={onSetVariable} />
              ))}
            </div>
          </div>
          <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-faint">
            Detected from <code className="text-dim">{'{{name}}'}</code> placeholders anywhere in the URL. Editing a
            value here writes it to the active environment, so every request sharing the variable picks it up.
          </p>
        </section>
      )}

      {pathVars.length === 0 && urlVariables.length === 0 && (
        <p className="px-0.5 text-[11.5px] leading-relaxed text-faint">
          To parameterize the path, use <code className="text-dim">{'{{variable}}'}</code> for something shared across
          requests (it resolves from your environment), or <code className="text-dim">:name</code> for a value that
          belongs to this one request. Either form shows up here as soon as it appears in the URL.
        </p>
      )}
    </div>
  );
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-2 px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
      {children}
    </div>
  );
}

function UrlVariableRow({ variable, onSetVariable }: { variable: UrlVariable; onSetVariable: (name: string, value: string) => void }) {
  return (
    <>
      <div className="bg-surface px-2.5 py-1 font-mono text-[12px] text-fg">{variable.name}</div>
      <div className="bg-surface px-1 py-1">
        {variable.dynamic ? (
          <span className="block px-2 py-1 font-mono text-[12px] text-faint">generated on each send</span>
        ) : (
          <Input
            value={variable.value}
            onChange={(e) => onSetVariable(variable.name, e.target.value)}
            placeholder={variable.source ? '' : 'Not defined — set a value'}
            className={variable.source ? undefined : 'border-warn/50'}
          />
        )}
      </div>
      <div className="whitespace-nowrap bg-surface px-2.5 py-1 text-[11px]">
        {variable.source ? (
          <span className="text-faint">{variable.source}</span>
        ) : (
          <span className="rounded bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">undefined</span>
        )}
      </div>
    </>
  );
}
