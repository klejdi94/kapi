import { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Trash2 } from 'lucide-react';
import type { RunHistoryEntry } from '@/types';
import { EmptyState, IconButton } from '@/components/ui/primitives';
import { formatDuration, formatRelativeTime } from '@/lib/format';
import { useRunHistory, useRunHistoryFor } from '@/store/runHistory';
import { methodVar } from '@/lib/methodColor';

function RunRow({ entry }: { entry: RunHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const remove = useRunHistory((s) => s.remove);
  const total = entry.passed + entry.failed + entry.errored;

  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2">
        <ChevronRight size={12} className={clsx('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <span className="w-16 shrink-0 text-[11px] text-faint">{formatRelativeTime(entry.at)}</span>
        {entry.scopeName && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-dim">{entry.scopeName}</span>}
        <span className={clsx('shrink-0 text-[12px] font-semibold', entry.failed || entry.errored ? 'text-danger' : 'text-ok')}>
          {entry.passed}/{total}
        </span>
        <span className="shrink-0 text-[11px] text-faint">passed</span>
        {entry.iterations > 1 && <span className="shrink-0 text-[10.5px] text-faint">· {entry.iterations} iterations</span>}
        <span className="ml-auto shrink-0 text-[10.5px] text-faint">{formatDuration(entry.durationMs)}</span>
        <IconButton
          label="Delete this run"
          tone="danger"
          className="shrink-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            remove(entry.id);
          }}
        >
          <Trash2 size={11} />
        </IconButton>
      </button>
      {open && (
        <div className="pb-1">
          {entry.results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1 pl-8 text-[11.5px]">
              <span className="w-12 shrink-0 text-[10px] font-bold" style={{ color: methodVar(r.method) }}>
                {r.method}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {r.path.length > 0 && <span className="text-faint">{r.path.join(' / ')} / </span>}
                {r.name}
              </span>
              {r.errorMessage && <span className="shrink-0 truncate text-[10.5px] text-danger">{r.errorMessage}</span>}
              <span className={clsx('shrink-0 text-[10.5px]', r.status === 'passed' ? 'text-ok' : 'text-danger')}>
                {r.httpStatus ?? 'error'}
                {r.testsTotal ? ` · ${r.testsPassed}/${r.testsTotal}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every past "Run collection" execution for this collection — a summary per run (no live responses, those are never persisted) so a regression shows up against an earlier pass rather than needing to be remembered. */
export function RunHistoryView({ collectionId }: { collectionId: string }) {
  const entries = useRunHistoryFor(collectionId);

  if (!entries.length) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState title="No runs yet" detail="Results from “Run collection” land here, so a later run can be compared against this one." />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {entries.map((entry) => (
        <RunRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
