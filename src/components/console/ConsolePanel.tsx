import { useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Ban,
  Braces,
  Check,
  ChevronRight,
  Copy,
  Globe,
  Plug,
  Server,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
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
  script: Braces,
  'script-error': TriangleAlert,
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
  script: 'text-dim',
  'script-error': 'text-danger',
};

/** Groups the ten entry kinds into the four things people actually filter by. */
type Channel = 'all' | 'http' | 'ws' | 'mock' | 'script';

const CHANNEL_OF: Record<ConsoleKind, Exclude<Channel, 'all'>> = {
  'http-request': 'http',
  'http-response': 'http',
  'http-error': 'http',
  'ws-connect': 'ws',
  'ws-send': 'ws',
  'ws-receive': 'ws',
  'ws-close': 'ws',
  'mock-hit': 'mock',
  script: 'script',
  'script-error': 'script',
};

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'http', label: 'HTTP' },
  { value: 'ws', label: 'WS' },
  { value: 'mock', label: 'Mock' },
  { value: 'script', label: 'Scripts' },
];

function timestamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function ConsolePanel({ height = 260 }: { height?: number }) {
  const entries = useConsole((s) => s.entries);
  const setOpen = useConsole((s) => s.setOpen);
  const clear = useConsole((s) => s.clear);
  const [filter, setFilter] = useState('');
  const [channel, setChannel] = useState<Channel>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const out: Record<Channel, number> = { all: entries.length, http: 0, ws: 0, mock: 0, script: 0 };
    for (const entry of entries) out[CHANNEL_OF[entry.kind]]++;
    return out;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (channel !== 'all' && CHANNEL_OF[e.kind] !== channel) return false;
      if (!q) return true;
      return (
        e.summary.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q) ||
        !!e.tabName?.toLowerCase().includes(q)
      );
    });
  }, [entries, filter, channel]);

  const copyAll = () => {
    const text = filtered
      .slice()
      .reverse()
      .map((e) => `[${timestamp(e.at)}] ${e.summary}\n${e.detail}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-surface" style={{ height }}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span className="text-accent">❯</span> Console
        </span>

        <div className="flex items-center gap-0.5">
          {CHANNELS.map((c) => (
            <button
              key={c.value}
              onClick={() => setChannel(c.value)}
              className={clsx(
                'flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors duration-100',
                channel === c.value ? 'bg-surface-3 text-fg' : 'text-faint hover:bg-surface-2 hover:text-dim',
              )}
            >
              {c.label}
              <span className="tnum text-[10px] opacity-60">{counts[c.value]}</span>
            </button>
          ))}
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="h-6.5 w-44 rounded border border-line bg-surface-2 px-2 font-mono text-[11.5px] transition-colors duration-100 focus:border-accent focus:outline-none"
        />
        <span className="flex-1" />
        <IconButton label="Copy visible entries" onClick={copyAll}>
          <Copy size={13} />
        </IconButton>
        <IconButton label="Clear console" onClick={clear}>
          <Trash2 size={13} />
        </IconButton>
        <IconButton label="Close console" onClick={() => setOpen(false)}>
          <X size={13} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]">
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-faint">
            {entries.length === 0
              ? 'Waiting for traffic — send a request, open a WebSocket, or hit the mock server.'
              : 'Nothing matches that filter.'}
            <span className="caret ml-1 text-accent">▌</span>
          </p>
        ) : (
          filtered.map((entry) => (
            <ConsoleRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ConsoleRow({ entry, expanded, onToggle }: { entry: ConsoleEntry; expanded: boolean; onToggle: () => void }) {
  const Icon = KIND_ICON[entry.kind];
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(`${entry.summary}\n\n${entry.detail}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="animate-slide-down group border-b border-line/60">
      <div className="flex w-full items-start gap-2 px-2.5 py-1 transition-colors duration-100 hover:bg-surface-2">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronRight
            size={11}
            className={clsx('mt-0.5 shrink-0 text-faint transition-transform duration-150', expanded && 'rotate-90')}
          />
          <Icon size={12} className={clsx('mt-0.5 shrink-0', KIND_COLOR[entry.kind])} />
          <span className="shrink-0 tabular-nums text-faint">{timestamp(entry.at)}</span>
          <span className="min-w-0 flex-1 truncate text-fg">{entry.summary}</span>
          {entry.tabName && <span className="hidden shrink-0 text-faint md:inline">{entry.tabName}</span>}
        </button>
        <button
          onClick={copy}
          title="Copy entry"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity duration-100 hover:text-fg group-hover:opacity-100"
        >
          {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
        </button>
      </div>
      {expanded && (
        <div className="animate-reveal">
          <pre className="whitespace-pre-wrap break-all border-t border-line/60 bg-surface-2 px-3 py-2 text-[11px] text-dim">
            {entry.detail}
          </pre>
        </div>
      )}
    </div>
  );
}
