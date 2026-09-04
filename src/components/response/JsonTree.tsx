import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Collapsible JSON viewer with a `$.path` filter box — no library, just recursion. */
export function JsonTree({ value }: { value: unknown }) {
  const [filter, setFilter] = useState('');
  const parsed = useMemo(() => normalizeFilter(filter), [filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter with a path, e.g. data.items[0].name"
          className="h-6.5 w-full max-w-xs rounded border border-line bg-surface px-2 font-mono text-[11.5px] placeholder:font-sans focus:border-accent focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed">
        <Node value={value as Json} name={null} depth={0} defaultOpen path={parsed} />
      </div>
    </div>
  );
}

function normalizeFilter(filter: string): (string | number)[] | null {
  const trimmed = filter.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
  if (!cleaned) return null;
  return cleaned.split('.').filter(Boolean).map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

function matchesPath(path: (string | number)[] | null, ancestry: (string | number)[]): 'exact' | 'ancestor' | 'none' {
  if (!path) return 'ancestor';
  const depth = Math.min(path.length, ancestry.length);
  for (let i = 0; i < depth; i++) {
    if (String(path[i]) !== String(ancestry[i])) return 'none';
  }
  return ancestry.length >= path.length ? 'exact' : 'ancestor';
}

function Node({
  value,
  name,
  depth,
  defaultOpen,
  path,
  ancestry = [],
}: {
  value: Json;
  name: string | number | null;
  depth: number;
  defaultOpen?: boolean;
  path: (string | number)[] | null;
  ancestry?: (string | number)[];
}) {
  const match = matchesPath(path, ancestry);
  const [open, setOpen] = useState(!!defaultOpen || match !== 'none');
  if (match === 'none') return null;

  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object' && !isArray;
  const isContainer = isArray || isObject;

  const keyLabel = name !== null && (
    <span className="text-accent">{typeof name === 'number' ? `[${name}]` : `"${name}"`}</span>
  );

  if (!isContainer) {
    return (
      <div className="flex gap-1 whitespace-nowrap" style={{ paddingLeft: depth * 14 }}>
        {name !== null && (
          <>
            {keyLabel}
            <span className="text-faint">:</span>
          </>
        )}
        <ScalarValue value={value} />
      </div>
    );
  }

  const entries = isArray ? (value as Json[]).map((v, i) => [i, v] as const) : Object.entries(value as Record<string, Json>);
  const bracket = isArray ? ['[', ']'] : ['{', '}'];

  return (
    <div>
      <div className="flex cursor-pointer items-center gap-1 whitespace-nowrap hover:bg-surface-2" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={11} className={clsx('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        {name !== null && (
          <>
            {keyLabel}
            <span className="text-faint">:</span>
          </>
        )}
        <span className="text-faint">
          {bracket[0]}
          {!open && `…${bracket[1]} `}
          {!open && <span className="text-faint/70">{entries.length} {isArray ? 'items' : 'keys'}</span>}
        </span>
      </div>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <Node key={k} value={v} name={k} depth={depth + 1} path={path} ancestry={[...ancestry, k]} />
          ))}
          <div className="text-faint" style={{ paddingLeft: depth * 14 }}>
            {bracket[1]}
          </div>
        </>
      )}
    </div>
  );
}

function ScalarValue({ value }: { value: Json }) {
  if (value === null) return <span style={{ color: 'var(--warn)' }}>null</span>;
  if (typeof value === 'boolean') return <span style={{ color: 'var(--warn)' }}>{String(value)}</span>;
  if (typeof value === 'number') return <span style={{ color: 'var(--warn)' }}>{value}</span>;
  if (typeof value === 'string') return <span style={{ color: 'var(--ok)' }}>&quot;{value}&quot;</span>;
  return null;
}
