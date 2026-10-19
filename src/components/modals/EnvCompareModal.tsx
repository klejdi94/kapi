import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import clsx from 'clsx';
import type { Collection, KapiResponse, RequestDef } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Badge, Button, Checkbox, EmptyState, Field, Input, Segmented, Select } from '@/components/ui/primitives';
import { ResponseDiffView } from '@/components/response/ResponseDiffView';
import { useActiveWorkspace } from '@/store/workspaces';
import { useEnvCompare } from '@/store/envCompare';
import { compareResponses, sendWithEnvironment, type SideResult } from '@/lib/envCompare';
import { sendWithCookies } from '@/lib/sendWithCookies';
import { formatBytes, formatDuration } from '@/lib/format';

function show(value: unknown): string {
  if (value === undefined) return '—';
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function SideSummary({ side, label }: { side: SideResult; label: string }) {
  const r = side.result;
  return (
    <div className="flex-1 rounded-md border border-line px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-faint">{label} · {side.environment?.name ?? 'No environment'}</div>
      {r.ok ? (
        <div className="tnum mt-1 flex items-center gap-2 text-[12px]">
          <Badge tone={r.response.status < 400 ? 'ok' : 'danger'}>{r.response.status} {r.response.statusText}</Badge>
          <span className="text-faint">{formatDuration(r.response.timings.total)} · {formatBytes(r.response.size.body)}</span>
        </div>
      ) : (
        <div className="mt-1 text-[12px] text-danger">{r.error.title}</div>
      )}
    </div>
  );
}

/**
 * Sends the open request through two environments and shows what differs:
 * status, headers (volatile ones like Date hidden by default) and, for JSON,
 * a path-by-path diff with paths you can ignore — or a line diff otherwise.
 */
export function EnvCompareModal({ request, collection }: { request: RequestDef | null; collection: Collection | null }) {
  const open = useEnvCompare((s) => s.open);
  const setOpen = useEnvCompare((s) => s.setOpen);
  const workspace = useActiveWorkspace();
  const envs = workspace.environments;
  const [aId, setAId] = useState<string>(() => workspace.activeEnvironmentId ?? envs[0]?.id ?? '');
  const [bId, setBId] = useState<string>(() => envs.find((e) => e.id !== (workspace.activeEnvironmentId ?? envs[0]?.id))?.id ?? '');
  const [ignore, setIgnore] = useState('');
  const [hideVolatile, setHideVolatile] = useState(true);
  const [view, setView] = useState<'changes' | 'lines'>('changes');
  const [running, setRunning] = useState(false);
  const [sides, setSides] = useState<[SideResult, SideResult] | null>(null);

  const comparison = useMemo(() => {
    if (!sides || !sides[0].result.ok || !sides[1].result.ok) return null;
    return compareResponses(sides[0].result.response, sides[1].result.response, ignore.split(/[\n,]/), hideVolatile);
  }, [sides, ignore, hideVolatile]);

  if (!open || !request) return null;

  const run = async () => {
    setRunning(true);
    setSides(null);
    try {
      const env = (id: string) => envs.find((e) => e.id === id) ?? null;
      const send = (r: RequestDef, s: Parameters<typeof sendWithCookies>[1]) => sendWithCookies(r, s);
      const [a, b] = await Promise.all([
        sendWithEnvironment(request, collection?.preRequestScript, workspace, collection, env(aId), send),
        sendWithEnvironment(request, collection?.preRequestScript, workspace, collection, env(bId), send),
      ]);
      setSides([a, b]);
    } finally {
      setRunning(false);
    }
  };

  const bothOk = sides && sides[0].result.ok && sides[1].result.ok;

  return (
    <Modal open onClose={() => setOpen(false)} title="Compare across environments" width={860}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <Field label="A" className="flex-1">
            <Select aria-label="Environment A" value={aId} onChange={(e) => setAId(e.target.value)}>
              <option value="">No environment</option>
              {envs.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="B" className="flex-1">
            <Select aria-label="Environment B" value={bId} onChange={(e) => setBId(e.target.value)}>
              <option value="">No environment</option>
              {envs.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" onClick={run} disabled={running}>
            <Play size={13} /> {running ? 'Sending…' : 'Send both'}
          </Button>
        </div>
        <Field label="Ignore JSON paths" hint="Comma or newline separated; * matches one segment — e.g. meta.requestId, items[*].updatedAt">
          <Input value={ignore} onChange={(e) => setIgnore(e.target.value)} placeholder="meta.requestId, items[*].updatedAt" />
        </Field>

        {!sides && !running && <EmptyState title="Pick two environments and send" detail="Pre-request scripts run for each; nothing is saved." />}

        {sides && (
          <div className="flex gap-3">
            <SideSummary side={sides[0]} label="A" />
            <SideSummary side={sides[1]} label="B" />
          </div>
        )}

        {bothOk && comparison && (
          <>
            <div className="flex items-center justify-between">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'changes', label: 'Changes', count: comparison.headers.length + (comparison.json?.length ?? (comparison.textSame ? 0 : 1)) + (comparison.statusSame ? 0 : 1) },
                  { value: 'lines', label: 'Line diff' },
                ]}
              />
              <Checkbox checked={hideVolatile} onChange={setHideVolatile} label="Hide volatile headers (Date, ETag, request ids…)" />
            </div>
            {view === 'lines' ? (
              <div className="max-h-[50vh] overflow-auto rounded-md border border-line">
                <ResponseDiffView before={(sides[0].result as { ok: true; response: KapiResponse }).response} after={(sides[1].result as { ok: true; response: KapiResponse }).response} />
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-md border border-line text-[12px]">
                {comparison.statusSame && !comparison.headers.length && (comparison.json ? !comparison.json.length : comparison.textSame) ? (
                  <p className="p-4 text-ok">The responses match{ignore.trim() ? ' (ignoring the paths above)' : ''}.</p>
                ) : (
                  <table className="w-full">
                    <thead className="sticky top-0 bg-surface-2 text-left text-[10.5px] uppercase tracking-wider text-faint">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Where</th>
                        <th className="px-3 py-1.5 font-medium">A</th>
                        <th className="px-3 py-1.5 font-medium">B</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {!comparison.statusSame && (
                        <tr className="border-t border-line/60">
                          <td className="px-3 py-1 text-dim">status</td>
                          <td className="px-3 py-1">{sides[0].result.ok && sides[0].result.response.status}</td>
                          <td className="px-3 py-1">{sides[1].result.ok && sides[1].result.response.status}</td>
                        </tr>
                      )}
                      {comparison.headers.map((h) => (
                        <tr key={h.name} className="border-t border-line/60">
                          <td className="px-3 py-1 text-dim">header {h.name}</td>
                          <td className={clsx('break-all px-3 py-1', h.a === null && 'text-faint')}>{h.a ?? '—'}</td>
                          <td className={clsx('break-all px-3 py-1', h.b === null && 'text-faint')}>{h.b ?? '—'}</td>
                        </tr>
                      ))}
                      {comparison.json?.map((c) => (
                        <tr key={c.path} className="border-t border-line/60">
                          <td className="px-3 py-1 text-dim">{c.path}</td>
                          <td className={clsx('break-all px-3 py-1', c.kind === 'added' ? 'text-faint' : 'text-danger')}>{c.kind === 'added' ? '—' : show(c.a)}</td>
                          <td className={clsx('break-all px-3 py-1', c.kind === 'removed' ? 'text-faint' : 'text-ok')}>{c.kind === 'removed' ? '—' : show(c.b)}</td>
                        </tr>
                      ))}
                      {!comparison.json && !comparison.textSame && (
                        <tr className="border-t border-line/60">
                          <td className="px-3 py-1 text-dim" colSpan={3}>
                            The bodies aren't JSON and differ — see the line diff.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
