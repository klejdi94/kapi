import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, Globe, Layers } from 'lucide-react';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { lookup, buildScope } from '@/lib/variables';
import type { Collection } from '@/types';

export function EnvironmentPicker({ collection }: { collection: Collection | null }) {
  const workspace = useActiveWorkspace();
  const setActiveEnvironment = useWorkspaces((s) => s.setActiveEnvironment);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const active = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
  const scope = buildScope(workspace, collection);
  const names = [...new Set([...workspace.globals, ...(collection?.variables ?? []), ...(active?.variables ?? [])].filter((r) => r.enabled && r.key.trim()).map((r) => r.key.trim()))];

  return (
    <div className="flex items-center gap-1 border-b border-line px-2 py-1.5" ref={ref}>
      <div className="relative flex-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-dim hover:bg-surface-2"
        >
          <Layers size={12} className="text-faint" />
          {active ? active.name : 'No environment'}
          <ChevronDown size={11} className="text-faint" />
        </button>
        {open && (
          <div className="animate-in absolute left-0 top-[calc(100%+2px)] z-30 w-56 overflow-hidden rounded-lg border border-line bg-surface-2 py-1 shadow-2xl" style={{ boxShadow: 'var(--shadow)' }}>
            <button
              onClick={() => { setActiveEnvironment(null); setOpen(false); }}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] hover:bg-surface-3"
            >
              <Check size={12} className={!active ? 'text-accent' : 'text-transparent'} />
              No environment
            </button>
            {workspace.environments.map((env) => (
              <button
                key={env.id}
                onClick={() => { setActiveEnvironment(env.id); setOpen(false); }}
                className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] hover:bg-surface-3"
              >
                <Check size={12} className={active?.id === env.id ? 'text-accent' : 'text-transparent'} />
                {env.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setPeek((p) => !p)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-fg"
          title="Preview resolved variables"
        >
          <Eye size={13} />
        </button>
        {peek && (
          <div className="animate-in absolute right-0 top-[calc(100%+2px)] z-30 max-h-72 w-72 overflow-y-auto rounded-lg border border-line bg-surface-2 p-2 shadow-2xl" style={{ boxShadow: 'var(--shadow)' }}>
            <p className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Resolved variables</p>
            {names.length === 0 && <p className="px-1 py-1 text-[11.5px] text-faint">No variables defined for this request.</p>}
            {names.map((name) => {
              const entry = lookup(scope, name);
              return (
                <div key={name} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-[11.5px] hover:bg-surface-3">
                  <span className="truncate font-mono text-fg">{name}</span>
                  <span className="flex items-center gap-1 truncate text-faint">
                    <Globe size={9} />
                    {entry?.value || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
