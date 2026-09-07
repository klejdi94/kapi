import { useState } from 'react';
import clsx from 'clsx';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/primitives';
import { diffLines, type DiffLine } from '@/lib/textDiff';
import type { KV } from '@/types';

const LINE_STYLE: Record<DiffLine['kind'], string> = { add: 'bg-ok/10 text-ok', remove: 'bg-danger/10 text-danger', context: 'text-dim' };
const LINE_PREFIX: Record<DiffLine['kind'], string> = { add: '+', remove: '-', context: ' ' };

export interface NamedVars {
  id: string;
  name: string;
  variables: KV[];
}

function textFor(vars: KV[], keys: string[]): string {
  const map = new Map(vars.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value]));
  return keys.map((k) => `${k}: ${map.has(k) ? map.get(k) : '(not set)'}`).join('\n');
}

/** Side-by-side variable comparison — same idea as the response diff, but for two variable scopes: every key either side has, aligned by name so only actual differences show as +/-. */
export function EnvironmentDiffModal({ open, onClose, options }: { open: boolean; onClose: () => void; options: NamedVars[] }) {
  const [aId, setAId] = useState(options[0]?.id ?? '');
  const [bId, setBId] = useState(options[1]?.id ?? options[0]?.id ?? '');

  if (!open) return null;
  const a = options.find((o) => o.id === aId) ?? options[0];
  const b = options.find((o) => o.id === bId) ?? options[0];
  const keys = a && b ? [...new Set([...a.variables, ...b.variables].filter((v) => v.key.trim()).map((v) => v.key.trim()))].sort() : [];
  const lines = a && b ? diffLines(textFor(a.variables, keys), textFor(b.variables, keys)) : [];
  const changed = lines.filter((l) => l.kind !== 'context').length / 2;

  return (
    <Modal open onClose={onClose} title="Compare environments" width={640}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Select value={aId} onChange={(e) => setAId(e.target.value)} className="flex-1">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <span className="shrink-0 text-[11px] text-faint">vs</span>
          <Select value={bId} onChange={(e) => setBId(e.target.value)} className="flex-1">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-[11px] text-faint">
          {keys.length} key{keys.length === 1 ? '' : 's'} total · {changed} differ
        </p>
        <div className="max-h-96 overflow-auto rounded-md border border-line bg-surface font-mono text-[12px] leading-relaxed">
          {lines.length ? (
            lines.map((line, i) => (
              <div key={i} className={clsx('flex whitespace-pre px-2', LINE_STYLE[line.kind])}>
                <span className="w-3 shrink-0 select-none opacity-60">{LINE_PREFIX[line.kind]}</span>
                <span>{line.text}</span>
              </div>
            ))
          ) : (
            <div className="px-2 py-2 text-faint">Nothing to compare.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
