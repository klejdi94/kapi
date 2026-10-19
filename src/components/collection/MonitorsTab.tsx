import { useState } from 'react';
import { Activity, Clipboard, Play, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { Collection, Monitor } from '@/types';
import { Badge, Button, Checkbox, EmptyState, Field, Select } from '@/components/ui/primitives';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { walk } from '@/lib/tree';
import { uid } from '@/lib/factory';
import { ciWorkflowFor } from '@/lib/monitors';
import { runMonitorNow } from '@/lib/monitorScheduler';
import { toast } from '@/lib/toast';

const INTERVALS = [
  [5, 'Every 5 minutes'],
  [15, 'Every 15 minutes'],
  [30, 'Every 30 minutes'],
  [60, 'Every hour'],
  [360, 'Every 6 hours'],
  [1440, 'Every day'],
] as const;

function timeAgo(at?: number): string {
  if (!at) return 'never';
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(at).toLocaleString();
}

/**
 * A collection's monitors: scheduled runs while kapi is open, with a system
 * notification when one fails (or changes status), and a ready-made GitHub
 * Actions workflow for the times kapi isn't open.
 */
export function MonitorsTab({ collection }: { collection: Collection }) {
  const workspace = useActiveWorkspace();
  const addMonitor = useWorkspaces((s) => s.addMonitor);
  const updateMonitor = useWorkspaces((s) => s.updateMonitor);
  const deleteMonitor = useWorkspaces((s) => s.deleteMonitor);
  const monitors = (workspace.monitors ?? []).filter((m) => m.collectionId === collection.id);
  const [ciFor, setCiFor] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const folders: { id: string; name: string }[] = [];
  walk(collection.items, (node, ancestors) => {
    if (node.type === 'folder') folders.push({ id: node.id, name: [...ancestors.map((a) => a.name), node.name].join(' / ') });
  });

  const add = () =>
    addMonitor({
      id: uid(),
      name: `${collection.name} health`,
      collectionId: collection.id,
      scopeNodeId: null,
      environmentId: workspace.activeEnvironmentId,
      intervalMinutes: 15,
      enabled: true,
      notify: 'failures',
    });

  const runNow = async (monitor: Monitor) => {
    setRunningId(monitor.id);
    try {
      await runMonitorNow(monitor);
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[12px] leading-relaxed text-faint">
          A monitor runs this collection (or one folder) on a schedule while kapi is open — scripts, tests and contract checks included —
          and notifies you when it fails. Each run starts from the saved variables and never changes them. Results land in History.
        </p>
        <Button size="sm" variant="primary" onClick={add}>
          <Plus size={12} /> New monitor
        </Button>
      </div>

      {!monitors.length && <EmptyState icon={<Activity size={26} />} title="No monitors yet" detail="Add one to keep an eye on this API while you work." />}

      {monitors.map((m) => {
        const env = workspace.environments.find((e) => e.id === m.environmentId);
        const ci = ciFor === m.id ? ciWorkflowFor(m, `${collection.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.kapi.json`, env ? `${env.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.json` : null) : '';
        return (
          <div key={m.id} className={clsx('rounded-lg border border-line p-3', !m.enabled && 'opacity-70')}>
            <div className="flex items-center gap-2">
              <input
                value={m.name}
                onChange={(e) => updateMonitor(m.id, { name: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-fg focus:outline-none"
                aria-label="Monitor name"
              />
              {m.lastStatus && <Badge tone={m.lastStatus === 'passed' ? 'ok' : 'danger'}>{m.lastStatus}</Badge>}
              <span className="text-[11px] text-faint">last run {timeAgo(m.lastRunAt)}</span>
            </div>
            {m.lastSummary && <p className="mt-1 text-[11.5px] text-dim">{m.lastSummary}</p>}
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Field label="Runs">
                <Select value={m.scopeNodeId ?? ''} onChange={(e) => updateMonitor(m.id, { scopeNodeId: e.target.value || null })}>
                  <option value="">Whole collection</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Environment">
                <Select value={m.environmentId ?? ''} onChange={(e) => updateMonitor(m.id, { environmentId: e.target.value || null })}>
                  <option value="">None</option>
                  {workspace.environments.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Schedule">
                <Select value={String(m.intervalMinutes)} onChange={(e) => updateMonitor(m.id, { intervalMinutes: Number(e.target.value) })}>
                  {INTERVALS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                  {!INTERVALS.some(([v]) => v === m.intervalMinutes) && <option value={m.intervalMinutes}>Every {m.intervalMinutes} min</option>}
                </Select>
              </Field>
              <Field label="Notify">
                <Select value={m.notify} onChange={(e) => updateMonitor(m.id, { notify: e.target.value as Monitor['notify'] })}>
                  <option value="failures">On every failure</option>
                  <option value="changes">When the status changes</option>
                  <option value="never">Never</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Checkbox checked={m.enabled} onChange={(enabled) => updateMonitor(m.id, { enabled })} label="Enabled" />
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" onClick={() => runNow(m)} disabled={runningId === m.id}>
                  <Play size={12} /> {runningId === m.id ? 'Running…' : 'Run now'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCiFor(ciFor === m.id ? null : m.id)}>
                  Run in CI…
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteMonitor(m.id)} aria-label="Delete monitor">
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
            {ci && (
              <div className="mt-3 rounded-md border border-line bg-surface-2">
                <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-faint">
                  <span>.github/workflows/kapi-monitor.yml — runs even when kapi is closed. Export the collection{env ? ' and environment' : ''} next to it first.</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigator.clipboard.writeText(ci).then(() => toast.success('Copied'), () => toast.error('Could not copy'))}
                  >
                    <Clipboard size={12} /> Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto p-3 font-mono text-[11.5px] text-fg">{ci}</pre>
              </div>
            )}
          </div>
        );
      })}
      {monitors.length > 0 && (
        <p className="text-[11px] text-faint">
          Monitors only run while kapi is open. Interval and schedule are checked every 30 seconds.
        </p>
      )}
    </div>
  );
}
