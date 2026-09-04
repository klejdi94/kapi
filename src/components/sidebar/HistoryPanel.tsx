import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useHistory } from '@/store/history';
import { useSession } from '@/store/session';
import { methodVar } from '@/lib/methodColor';
import { dayBucket, formatDuration, statusTone } from '@/lib/format';
import { IconButton, Badge, EmptyState } from '@/components/ui/primitives';
import { History } from 'lucide-react';
import { confirmAction } from '@/lib/confirm';

export function HistoryPanel() {
  const entries = useHistory((s) => s.entries);
  const clear = useHistory((s) => s.clear);
  const remove = useHistory((s) => s.remove);
  const openTab = useSession((s) => s.openTab);

  const groups = useMemo(() => {
    const map = new Map<string, typeof entries>();
    for (const entry of entries) {
      const bucket = dayBucket(entry.at);
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket)!.push(entry);
    }
    return [...map.entries()];
  }, [entries]);

  if (!entries.length) {
    return <EmptyState icon={<History size={22} />} title="No requests sent yet" detail="Everything you send shows up here, kept only in this browser." />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">History</span>
        <IconButton label="Clear history" tone="danger" onClick={async () => {
          if (await confirmAction('Clear all request history?', { okLabel: 'Clear', danger: true })) clear();
        }}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-2">
        {groups.map(([bucket, items]) => (
          <div key={bucket} className="mb-1">
            <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{bucket}</div>
            {items.map((entry) => (
              <div key={entry.id} className="group flex min-w-0 items-center gap-1">
                <button
                  onClick={() => openTab({ name: entry.name, request: structuredClone(entry.request) })}
                  className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left hover:bg-surface-2"
                >
                  <span className="w-9 shrink-0 text-right text-[9.5px] font-bold" style={{ color: methodVar(entry.method) }}>
                    {entry.method.slice(0, 4)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-dim">{entry.url}</span>
                  {entry.status !== null ? (
                    <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                  ) : (
                    <Badge tone="danger">err</Badge>
                  )}
                  <span className="tnum w-12 shrink-0 text-right text-[10.5px] text-faint">{formatDuration(entry.duration)}</span>
                </button>
                <IconButton label="Remove" tone="danger" className="opacity-0 group-hover:opacity-100" onClick={() => remove(entry.id)}>
                  <Trash2 size={11} />
                </IconButton>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
