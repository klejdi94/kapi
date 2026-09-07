import { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Trash2 } from 'lucide-react';
import type { OpenApiHistoryEntry } from '@/types';
import { EmptyState, IconButton } from '@/components/ui/primitives';
import { formatRelativeTime } from '@/lib/format';
import { useOpenApiHistory, useOpenApiHistoryFor } from '@/store/openapiHistory';

function ChangeList({ label, tone, items }: { label: string; tone: 'ok' | 'danger' | 'info'; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex gap-2 px-3 py-1 pl-8 text-[11.5px]">
      <span className={clsx('w-16 shrink-0 font-semibold', tone === 'ok' && 'text-ok', tone === 'danger' && 'text-danger', tone === 'info' && 'text-info')}>
        {label}
      </span>
      <span className="min-w-0 flex-1 text-dim">{items.join(', ')}</span>
    </div>
  );
}

function SyncRow({ entry }: { entry: OpenApiHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const remove = useOpenApiHistory((s) => s.remove);
  const changeCount = entry.added.length + entry.removed.length + entry.changed.length;

  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2">
        <ChevronRight size={12} className={clsx('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <span className="w-16 shrink-0 text-[11px] text-faint">{formatRelativeTime(entry.at)}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim" title={entry.source}>
          {entry.source}
        </span>
        <span className={clsx('shrink-0 text-[11px] font-semibold', changeCount ? 'text-accent' : 'text-faint')}>
          {changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : 'no changes'}
        </span>
        <IconButton
          label="Delete this sync from history"
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
        <div className="pb-2">
          <ChangeList label="Added" tone="ok" items={entry.added} />
          <ChangeList label="Changed" tone="info" items={entry.changed} />
          <ChangeList label="Removed" tone="danger" items={entry.removed} />
          {!changeCount && <p className="px-3 py-1 pl-8 text-[11px] text-faint">The spec matched what kapi already had.</p>}
        </div>
      )}
    </div>
  );
}

/** Every past `kapi_sync_openapi`/`kapi_import_openapi` call for this collection — most often run by an AI CLI through kapi's MCP server (see the README) rather than by hand, so this is where a person actually sees what changed in a backend's API surface over time. */
export function SpecHistoryView({ collectionId }: { collectionId: string }) {
  const entries = useOpenApiHistoryFor(collectionId);

  if (!entries.length) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          title="No spec syncs yet"
          detail="Run kapi_sync_openapi (or kapi_import_openapi) from an AI CLI connected to kapi's MCP server, and each sync's added/changed/removed endpoints will land here."
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {entries.map((entry) => (
        <SyncRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
