import { useMemo } from 'react';
import { Bot, FileDown, FlaskConical, FolderPlus, ListChecks, Plus, Radar, RefreshCw, Timer } from 'lucide-react';
import type { RunHistoryEntry, Workspace } from '@/types';
import { EmptyState } from '@/components/ui/primitives';
import { formatDuration, formatRelativeTime } from '@/lib/format';
import { useRunHistory } from '@/store/runHistory';
import { useOpenApiHistory } from '@/store/openapiHistory';

const SPARKLINE_DAYS = 14;

export interface WorkspaceOverviewActions {
  onNewRequest: () => void;
  onAskAi: () => void;
  onImport: () => void;
  onNewCollection: () => void;
  onDiscover: () => void;
}

function QuickActions({ actions }: { actions: WorkspaceOverviewActions }) {
  const tiles: { label: string; detail: string; icon: React.ReactNode; onClick: () => void; primary?: boolean }[] = [
    { label: 'New request', detail: 'Start from a blank request', icon: <Plus size={16} />, onClick: actions.onNewRequest, primary: true },
    { label: 'Ask AI to create a request', detail: 'Describe it, kapi builds it', icon: <Bot size={16} />, onClick: actions.onAskAi },
    { label: 'New collection', detail: 'Group related requests', icon: <FolderPlus size={16} />, onClick: actions.onNewCollection },
    { label: 'Import', detail: 'Postman, OpenAPI, HAR, cURL…', icon: <FileDown size={16} />, onClick: actions.onImport },
    { label: 'Discover an API', detail: 'Browse a site, capture its calls', icon: <Radar size={16} />, onClick: actions.onDiscover },
  ];

  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <button
          key={tile.label}
          onClick={tile.onClick}
          className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
            tile.primary
              ? 'border-accent/40 bg-accent/10 hover:bg-accent/15'
              : 'border-line bg-surface hover:bg-surface-2'
          }`}
        >
          <span className={tile.primary ? 'text-accent' : 'text-faint'}>{tile.icon}</span>
          <span className="text-[12.5px] font-medium text-fg">{tile.label}</span>
          <span className="text-[10.5px] leading-snug text-faint">{tile.detail}</span>
        </button>
      ))}
    </div>
  );
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function KpiTile({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-faint">
        {icon}
        {label}
      </div>
      <div className="text-[22px] font-semibold tnum text-fg">{value}</div>
      {detail && <div className="text-[10.5px] text-faint">{detail}</div>}
    </div>
  );
}

function Sparkline({ runs }: { runs: RunHistoryEntry[] }) {
  const days = useMemo(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    const keys: string[] = [];
    for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = dayKey(d.getTime());
      keys.push(key);
      buckets.set(key, 0);
    }
    for (const run of runs) {
      const key = dayKey(run.at);
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + run.passed + run.failed + run.errored);
    }
    return keys.map((key) => buckets.get(key) ?? 0);
  }, [runs]);

  const max = Math.max(...days, 1);

  return (
    <div className="flex h-12 items-end gap-1">
      {days.map((count, i) => (
        <div
          key={i}
          className="min-w-[6px] flex-1 rounded-t bg-accent/70"
          style={{ height: `${Math.max(2, (count / max) * 100)}%` }}
          title={`${count} request${count === 1 ? '' : 's'}`}
        />
      ))}
    </div>
  );
}

type ActivityItem =
  | { kind: 'run'; at: number; entry: RunHistoryEntry }
  | { kind: 'spec'; at: number; entry: { id: string; collectionName: string; source: string; added: string[]; removed: string[]; changed: string[] } };

/**
 * Shown whenever no tab is open — this is now the real "home" of a
 * workspace, not a gap papered over by silently reopening a blank request
 * (that used to be the only thing here, making "close all tabs" a no-op).
 * Quick actions up top get you into any of kapi's main flows in one click;
 * below that, the same activity that "Run collection" and an AI's
 * `kapi_sync_openapi` calls produce, pulled together at the workspace level
 * for the first time instead of being visible only one collection at a time.
 */
export function WorkspaceOverview({ workspace, actions }: { workspace: Workspace; actions: WorkspaceOverviewActions }) {
  const collectionIds = useMemo(() => new Set(workspace.collections.map((c) => c.id)), [workspace.collections]);
  // Selecting `s.entries` (a reference that's stable between actual store
  // mutations) and filtering in a separate `useMemo`, rather than filtering
  // right inside the zustand selector — a selector that allocates a new
  // array on every call never settles into a stable snapshot, which sent
  // this into "Maximum update depth exceeded" the moment it mounted.
  const runEntries = useRunHistory((s) => s.entries);
  const specEntries = useOpenApiHistory((s) => s.entries);
  const runs = useMemo(() => runEntries.filter((e) => collectionIds.has(e.collectionId)), [runEntries, collectionIds]);
  const specSyncs = useMemo(() => specEntries.filter((e) => collectionIds.has(e.collectionId)), [specEntries, collectionIds]);

  const totals = useMemo(() => {
    const requests = runs.reduce((sum, r) => sum + r.passed + r.failed + r.errored, 0);
    const passed = runs.reduce((sum, r) => sum + r.passed, 0);
    const durationMs = runs.reduce((sum, r) => sum + r.durationMs, 0);
    return {
      runs: runs.length,
      requests,
      passRate: requests ? Math.round((passed / requests) * 100) : null,
      avgDurationMs: runs.length ? durationMs / runs.length : null,
    };
  }, [runs]);

  const activity: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = [
      ...runs.map((entry): ActivityItem => ({ kind: 'run', at: entry.at, entry })),
      ...specSyncs.map((entry): ActivityItem => ({ kind: 'spec', at: entry.at, entry })),
    ];
    return items.sort((a, b) => b.at - a.at).slice(0, 15);
  }, [runs, specSyncs]);

  if (!workspace.collections.length) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <h1 className="mb-1 text-[16px] font-semibold text-fg">{workspace.name}</h1>
        <p className="mb-4 text-[11.5px] text-faint">Nothing here yet — pick a place to start.</p>
        <QuickActions actions={actions} />
        <EmptyState
          title="Every request you send will live in a collection"
          detail="Create one above, import an existing Postman/OpenAPI collection, or ask an AI CLI connected to kapi's MCP server to build one for you."
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <h1 className="mb-1 text-[16px] font-semibold text-fg">{workspace.name}</h1>
      <p className="mb-4 text-[11.5px] text-faint">
        {workspace.collections.length} collection{workspace.collections.length === 1 ? '' : 's'} · {workspace.environments.length} environment
        {workspace.environments.length === 1 ? '' : 's'}
      </p>

      <QuickActions actions={actions} />

      <div className="mb-5 flex flex-wrap gap-3">
        <KpiTile icon={<ListChecks size={12} />} label="Runs" value={String(totals.runs)} detail={`${totals.requests} request${totals.requests === 1 ? '' : 's'} total`} />
        <KpiTile
          icon={<FlaskConical size={12} />}
          label="Pass rate"
          value={totals.passRate === null ? '—' : `${totals.passRate}%`}
        />
        <KpiTile icon={<Timer size={12} />} label="Avg run time" value={totals.avgDurationMs === null ? '—' : formatDuration(totals.avgDurationMs)} />
      </div>

      <div className="mb-5 rounded-lg border border-line bg-surface p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Requests run, last {SPARKLINE_DAYS} days</div>
        <Sparkline runs={runs} />
      </div>

      <div className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-faint">Recent activity</div>
        {activity.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing yet" detail="Run a collection, or sync a collection with an OpenAPI spec, and it'll show up here." />
          </div>
        ) : (
          <div>
            {activity.map((item) =>
              item.kind === 'run' ? (
                <div key={`run-${item.entry.id}`} className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] last:border-0">
                  <ListChecks size={12} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">
                    <strong className="font-medium text-fg">{item.entry.collectionName}</strong>
                    {item.entry.scopeName ? ` / ${item.entry.scopeName}` : ''} —{' '}
                    <span style={{ color: item.entry.failed || item.entry.errored ? 'var(--danger)' : 'var(--ok)' }}>
                      {item.entry.passed}/{item.entry.passed + item.entry.failed + item.entry.errored} passed
                    </span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-faint">{formatRelativeTime(item.entry.at)}</span>
                </div>
              ) : (
                <div key={`spec-${item.entry.id}`} className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] last:border-0">
                  <RefreshCw size={12} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">
                    <strong className="font-medium text-fg">{item.entry.collectionName}</strong> synced from{' '}
                    <span className="text-dim">{item.entry.source}</span> —{' '}
                    {item.entry.added.length + item.entry.removed.length + item.entry.changed.length} change
                    {item.entry.added.length + item.entry.removed.length + item.entry.changed.length === 1 ? '' : 's'}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-faint">{formatRelativeTime(item.at)}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

