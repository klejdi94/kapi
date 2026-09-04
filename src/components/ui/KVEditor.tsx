import { useRef } from 'react';
import { Copy, FileUp, Trash2 } from 'lucide-react';
import type { KV } from '@/types';
import { kv, withTrailingBlank } from '@/lib/factory';
import { variableSpans } from '@/lib/variables';
import { IconButton } from './primitives';
import { putFile, dropFile, getFile } from '@/lib/files';

/**
 * The params/headers/form-data/urlencoded/variables grid used everywhere in
 * the app. Always keeps one trailing blank row so typing a new pair never
 * requires an explicit "add row" click — the Postman behaviour people expect.
 */
export function KVEditor({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  showDescription = false,
  allowFiles = false,
  disabledHint,
  resolve,
}: {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
  allowFiles?: boolean;
  disabledHint?: (row: KV) => string | undefined;
  /** Optional live-preview resolver so {{vars}} show their value on hover. */
  resolve?: (text: string) => string;
}) {
  const commit = (next: KV[]) => onChange(withTrailingBlank(next));

  const update = (id: string, patch: Partial<KV>) => commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => {
    dropFile(id);
    commit(rows.filter((r) => r.id !== id));
  };

  const cols = showDescription ? 'grid-cols-[20px_1fr_1fr_1fr_28px]' : 'grid-cols-[20px_1fr_1fr_28px]';

  return (
    <div className="flex flex-col">
      <div className={`grid ${cols} gap-px border-b border-line bg-line px-0 pb-px text-[10.5px] font-medium uppercase tracking-wider text-faint`}>
        <div className="bg-bg py-1.5" />
        <div className="bg-bg py-1.5 pl-1">Key</div>
        <div className="bg-bg py-1.5 pl-1">Value</div>
        {showDescription && <div className="bg-bg py-1.5 pl-1">Description</div>}
        <div className="bg-bg py-1.5" />
      </div>
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1;
        const isBlank = !row.key && !row.value && !row.fileName;
        const hint = disabledHint?.(row);
        return (
          <Row
            key={row.id}
            row={row}
            cols={cols}
            showDescription={showDescription}
            allowFiles={allowFiles}
            hint={hint}
            resolve={resolve}
            keyPlaceholder={keyPlaceholder}
            valuePlaceholder={valuePlaceholder}
            onToggle={(enabled) => update(row.id, { enabled })}
            onKey={(key) => update(row.id, { key })}
            onValue={(value) => update(row.id, { value })}
            onDescription={(description) => update(row.id, { description })}
            onKind={(kind) => update(row.id, { kind, value: kind === 'file' ? '' : row.value })}
            onFile={(file) => {
              putFile(row.id, file);
              update(row.id, { fileName: file.name });
            }}
            onDelete={isLast && isBlank ? undefined : () => remove(row.id)}
            onDuplicate={() => commit([...rows.slice(0, index + 1), kv({ key: row.key, value: row.value }), ...rows.slice(index + 1)])}
          />
        );
      })}
    </div>
  );
}

function Row({
  row,
  cols,
  showDescription,
  allowFiles,
  hint,
  resolve,
  keyPlaceholder,
  valuePlaceholder,
  onToggle,
  onKey,
  onValue,
  onDescription,
  onKind,
  onFile,
  onDelete,
  onDuplicate,
}: {
  row: KV;
  cols: string;
  showDescription: boolean;
  allowFiles: boolean;
  hint?: string;
  resolve?: (text: string) => string;
  onToggle: (enabled: boolean) => void;
  onKey: (key: string) => void;
  onValue: (value: string) => void;
  onDescription: (description: string) => void;
  onKind: (kind: 'text' | 'file') => void;
  onFile: (file: File) => void;
  onDelete?: () => void;
  onDuplicate: () => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const hasVars = variableSpans(row.value).length > 0;
  const preview = hasVars && resolve ? resolve(row.value) : null;

  return (
    <div className={`group grid ${cols} items-center gap-px bg-line`}>
      <div className="flex h-8 items-center justify-center bg-surface">
        <input
          type="checkbox"
          checked={row.enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
        />
      </div>
      <input
        value={row.key}
        onChange={(e) => onKey(e.target.value)}
        placeholder={keyPlaceholder}
        className="h-8 w-full bg-surface px-1.5 text-[12.5px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent disabled:opacity-50"
        disabled={row.auto}
        title={row.auto ? 'Generated automatically by kapi' : undefined}
      />
      {row.kind === 'file' ? (
        <div className="flex h-8 items-center gap-1.5 bg-surface px-1.5">
          <button
            onClick={() => fileInput.current?.click()}
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-[12px] text-dim hover:text-fg"
          >
            <FileUp size={12} className="shrink-0" />
            <span className="truncate">{row.fileName || 'Select file…'}</span>
          </button>
          {row.fileName && !getFile(row.id) && (
            <span className="shrink-0 text-[10.5px] text-warn" title="Files can't be saved to your browser's storage — pick it again to send it">
              reselect
            </span>
          )}
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </div>
      ) : (
        <input
          value={row.value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={valuePlaceholder}
          title={preview && preview !== row.value ? `→ ${preview}` : undefined}
          className="h-8 w-full bg-surface px-1.5 text-[12.5px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent disabled:opacity-50"
          disabled={row.auto}
        />
      )}
      {showDescription && (
        <input
          value={row.description ?? ''}
          onChange={(e) => onDescription(e.target.value)}
          placeholder="—"
          className="h-8 w-full bg-surface px-1.5 text-[12px] text-faint placeholder:text-faint/60 focus:text-fg focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        />
      )}
      <div className="flex h-8 items-center justify-center gap-0.5 bg-surface pr-0.5 opacity-0 group-hover:opacity-100">
        {allowFiles && row.kind !== 'file' && !row.key && !row.value && (
          <IconButton label="Switch to file" onClick={() => onKind('file')}>
            <FileUp size={12} />
          </IconButton>
        )}
        {(row.key || row.value) && (
          <IconButton label="Duplicate row" onClick={onDuplicate}>
            <Copy size={11} />
          </IconButton>
        )}
        {onDelete && (
          <IconButton label="Delete row" tone="danger" onClick={onDelete}>
            <Trash2 size={12} />
          </IconButton>
        )}
      </div>
      {hint && <div className="col-span-full bg-surface px-1.5 pb-1 text-[10.5px] text-warn">{hint}</div>}
    </div>
  );
}
