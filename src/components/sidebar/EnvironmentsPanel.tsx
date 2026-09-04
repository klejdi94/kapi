import { useState } from 'react';
import { Check, Globe, Plus, Trash2 } from 'lucide-react';
import { useWorkspaces, useActiveWorkspace } from '@/store/workspaces';
import { KVEditor } from '@/components/ui/KVEditor';
import { IconButton, Button } from '@/components/ui/primitives';
import clsx from 'clsx';

export function EnvironmentsPanel() {
  const workspace = useActiveWorkspace();
  const addEnvironment = useWorkspaces((s) => s.addEnvironment);
  const updateEnvironment = useWorkspaces((s) => s.updateEnvironment);
  const deleteEnvironment = useWorkspaces((s) => s.deleteEnvironment);
  const setActiveEnvironment = useWorkspaces((s) => s.setActiveEnvironment);
  const setGlobals = useWorkspaces((s) => s.setGlobals);

  const [selected, setSelected] = useState<'globals' | string>(workspace.activeEnvironmentId ?? 'globals');
  const current = selected === 'globals' ? null : workspace.environments.find((e) => e.id === selected);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Environments</span>
        <IconButton label="New environment" onClick={() => setSelected(addEnvironment())}>
          <Plus size={13} />
        </IconButton>
      </div>

      <div className="flex flex-col gap-0.5 px-1.5">
        <button
          onClick={() => setSelected('globals')}
          className={clsx('flex h-7 items-center gap-2 rounded px-2 text-left text-[12.5px]', selected === 'globals' ? 'bg-surface-2 text-fg' : 'text-dim hover:bg-surface-2')}
        >
          <Globe size={12} className="text-faint" />
          Globals
        </button>
        {workspace.environments.map((env) => (
          <div key={env.id} className="group flex items-center gap-1">
            <button
              onClick={() => setSelected(env.id)}
              className={clsx('flex h-7 flex-1 items-center gap-2 rounded px-2 text-left text-[12.5px]', selected === env.id ? 'bg-surface-2 text-fg' : 'text-dim hover:bg-surface-2')}
            >
              <span
                className={clsx('h-3.5 w-3.5 shrink-0 rounded-full border', workspace.activeEnvironmentId === env.id ? 'border-accent bg-accent/20' : 'border-line-strong')}
              >
                {workspace.activeEnvironmentId === env.id && <Check size={10} className="text-accent" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{env.name}</span>
            </button>
            <IconButton
              label="Delete"
              tone="danger"
              className="opacity-0 group-hover:opacity-100"
              onClick={() => deleteEnvironment(env.id)}
            >
              <Trash2 size={11} />
            </IconButton>
          </div>
        ))}
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-line p-3">
        {selected === 'globals' ? (
          <>
            <p className="mb-2 text-[11px] text-faint">Available in every workspace request — the weakest scope.</p>
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={workspace.globals} onChange={setGlobals} showDescription />
            </div>
          </>
        ) : current ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <input
                value={current.name}
                onChange={(e) => updateEnvironment(current.id, { name: e.target.value })}
                className="h-7 flex-1 rounded border border-transparent bg-transparent px-1 text-[13px] font-semibold hover:border-line focus:border-accent focus:outline-none"
              />
              {workspace.activeEnvironmentId !== current.id && (
                <Button size="sm" variant="primary" onClick={() => setActiveEnvironment(current.id)}>
                  Activate
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={current.variables} onChange={(variables) => updateEnvironment(current.id, { variables })} showDescription />
            </div>
          </>
        ) : (
          <p className="text-[12px] text-faint">Select or create an environment.</p>
        )}
      </div>
    </div>
  );
}
