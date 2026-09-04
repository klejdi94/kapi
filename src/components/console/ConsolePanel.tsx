import { useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Ban, Globe, Plug, Server, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useConsole, type ConsoleEntry, type ConsoleKind } from '@/store/console';
import { IconButton } from '@/components/ui/primitives';

const KIND_ICON: Record<ConsoleKind, typeof Globe> = {
  'http-request': ArrowUpCircle,
  'http-response': ArrowDownCircle,
  'http-error': Ban,
  'ws-connect': Plug,
  'ws-send': ArrowUpCircle,
  'ws-receive': ArrowDownCircle,
  'ws-close': Plug,
  'mock-hit': Server,
};

const KIND_COLOR: Record<ConsoleKind, string> = {
  'http-request': 'text-info',
  'http-response': 'text-ok',
  'http-error': 'text-danger',
  'ws-connect': 'text-accent',
  'ws-send': 'text-accent',
  'ws-receive': 'text-info',
  'ws-close': 'text-faint',
  'mock-hit': 'text-warn',
};

export function ConsolePanel({ height = 260 }: { height?: number }) {
  const entries = useConsole((s) => s.entries);
  const setOpen = useConsole((s) => s.setOpen);
  const clear = useConsole((s) => s.clear);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const q = filter.toLowerCase();
    return entries.filter((e) => e.summary.toLowerCase().includes(q) || e.tabName?.toLowerCase().includes(q));
  }, [entries, filter]);

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-surface" style={{ height }}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Console</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="h-6.5 w-48 rounded border border-line bg-surface-2 px-2 text-[11.5px] focus:border-accent focus:outline-none"
        />
        <span className="tnum text-[10.5px] text-faint">{filtered.length}</span>
        <span className="flex-1" />
        <IconButton label="Clear console" onClick={clear}>
          <Trash2 size={13} />
        </IconButton>
        <IconButton label="Close console" onClick={() => setOpen(false)}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]">
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-faint">Nothing logged yet — send a request, open a WebSocket, or hit the mock server.</p>
        ) : (
          filtered.map((entry) => <ConsoleRow key={entry.id} entry={entry} expanded={expandedId === entry.id} onToggle={() => setExpandedId((id) => (id === entry.id ? null : entry.id))} />)
        )}
      </div>
    </div>
  );
}

function ConsoleRow({ entry, expanded, onToggle }: { entry: ConsoleEntry; expanded: boolean; onToggle: () => void }) {
  const Icon = KIND_ICON[entry.kind];
  return (
    <div className="border-b border-line/60">
      <button onClick={onToggle} className="flex w-full items-start gap-2 px-2.5 py-1 text-left hover:bg-surface-2">
        <Icon size={12} className={clsx('mt-0.5 shrink-0', KIND_COLOR[entry.kind])} />
        <span className="shrink-0 text-faint">{new Date(entry.at).toLocaleTimeString()}</span>
        <span className="min-w-0 flex-1 truncate text-fg">{entry.summary}</span>
      </button>
      {expanded && (
        <pre className="whitespace-pre-wrap break-all border-t border-line/60 bg-surface-2 px-3 py-2 text-[11px] text-dim">{entry.detail}</pre>
      )}
    </div>
  );
}
