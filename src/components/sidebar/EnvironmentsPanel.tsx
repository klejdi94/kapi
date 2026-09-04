import { useState } from 'react';
import { Check, Globe, Plus, Trash2 } from 'lucide-react';
import { useWorkspaces, useActiveWorkspace } from '@/store/workspaces';
import { KVEditor } from '@/components/ui/KVEditor';
import { IconButton, Button, Field } from '@/components/ui/primitives';
import { confirmAction } from '@/lib/confirm';
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
  const activeName = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId)?.name;

  const removeEnvironment = async (id: string, name: string) => {
    if (!(await confirmAction(`Delete environment "${name}"? Its variables go with it.`, { okLabel: 'Delete', danger: true }))) return;
    deleteEnvironment(id);
    if (selected === id) setSelected('globals');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Environments</span>
        <IconButton label="New environment" onClick={() => setSelected(addEnvironment())}>
          <Plus size={13} />
        </IconButton>
      </div>

      <p className="px-2.5 pb-2 text-[11px] leading-snug text-faint">
        Variables fill <code className="text-dim">{'{{name}}'}</code> placeholders in URLs, headers, auth and bodies.
        Only the {activeName ? <span className="font-semibold text-accent">{activeName}</span> : 'active'} environment
        applies — it beats collection variables, which beat globals.
      </p>

      <div className="flex flex-col gap-0.5 px-1.5">
        <button
          onClick={() => setSelected('globals')}
          className={clsx(
            'flex h-7 items-center gap-2 rounded px-2 text-left text-[12.5px] transition-colors duration-100',
            selected === 'globals' ? 'bg-surface-2 text-fg' : 'text-dim hover:bg-surface-2',
          )}
        >
          <Globe size={12} className="text-faint" />
          Globals
        </button>
        {workspace.environments.map((env) => {
          const isActive = workspace.activeEnvironmentId === env.id;
          return (
            <div key={env.id} className="group flex items-center gap-1">
              <button
                onClick={() => setActiveEnvironment(isActive ? null : env.id)}
                title={isActive ? 'Deactivate' : `Activate "${env.name}"`}
                className={clsx(
                  'ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-100',
                  isActive ? 'border-accent bg-accent/20 text-accent' : 'border-line-strong hover:border-accent',
                )}
              >
                {isActive && <Check size={10} />}
              </button>
              <button
                onClick={() => setSelected(env.id)}
                onDoubleClick={() => setSelected(env.id)}
                className={clsx(
                  'flex h-7 min-w-0 flex-1 items-center rounded px-2 text-left text-[12.5px] transition-colors duration-100',
                  selected === env.id ? 'bg-surface-2 text-fg' : 'text-dim hover:bg-surface-2',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{env.name}</span>
              </button>
              <IconButton
                label="Delete environment"
                tone="danger"
                className="opacity-0 transition-opacity duration-100 group-hover:opacity-100"
                onClick={() => removeEnvironment(env.id, env.name)}
              >
                <Trash2 size={11} />
              </IconButton>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-t border-line p-3">
        {selected === 'globals' ? (
          <>
            <p className="text-[11px] text-faint">Available in every workspace request — the weakest scope.</p>
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={workspace.globals} onChange={setGlobals} showDescription />
            </div>
          </>
        ) : current ? (
          <>
            <div className="flex items-end gap-2">
              <Field label="Environment name" className="flex-1">
                <input
                  value={current.name}
                  onChange={(e) => updateEnvironment(current.id, { name: e.target.value })}
                  placeholder="Staging"
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] font-semibold transition-colors duration-100 focus:border-accent focus:outline-none"
                />
              </Field>
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
