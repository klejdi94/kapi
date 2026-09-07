import { useRef, useState } from 'react';
import { Check, FileUp, GitCompareArrows, Globe, Plus, Trash2 } from 'lucide-react';
import { useWorkspaces, useActiveWorkspace } from '@/store/workspaces';
import { KVEditor } from '@/components/ui/KVEditor';
import { IconButton, Button, Field } from '@/components/ui/primitives';
import { EnvironmentDiffModal } from './EnvironmentDiffModal';
import { confirmAction } from '@/lib/confirm';
import { kv, withTrailingBlank } from '@/lib/factory';
import { parseDotenv } from '@/lib/dotenv';
import { toast } from '@/lib/toast';
import type { KV } from '@/types';
import clsx from 'clsx';

export function EnvironmentsPanel() {
  const workspace = useActiveWorkspace();
  const addEnvironment = useWorkspaces((s) => s.addEnvironment);
  const updateEnvironment = useWorkspaces((s) => s.updateEnvironment);
  const deleteEnvironment = useWorkspaces((s) => s.deleteEnvironment);
  const setActiveEnvironment = useWorkspaces((s) => s.setActiveEnvironment);
  const setGlobals = useWorkspaces((s) => s.setGlobals);

  const [selected, setSelected] = useState<'globals' | string>(workspace.activeEnvironmentId ?? 'globals');
  const [diffOpen, setDiffOpen] = useState(false);
  const current = selected === 'globals' ? null : workspace.environments.find((e) => e.id === selected);
  const activeName = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId)?.name;
  const dotenvInput = useRef<HTMLInputElement>(null);

  const importDotenv = (text: string, target: KV[], apply: (rows: KV[]) => void) => {
    const parsed = parseDotenv(text);
    if (parsed.length === 0) {
      toast.error('No KEY=value lines found in that file');
      return;
    }
    const next = [...target];
    let added = 0;
    let updated = 0;
    for (const { key, value } of parsed) {
      const idx = next.findIndex((r) => r.key === key);
      if (idx === -1) {
        next.push(kv({ key, value }));
        added++;
      } else {
        next[idx] = { ...next[idx], value };
        updated++;
      }
    }
    apply(withTrailingBlank(next));
    toast.success('Imported .env', `${added} added, ${updated} updated`);
  };

  const removeEnvironment = async (id: string, name: string) => {
    if (!(await confirmAction(`Delete environment "${name}"? Its variables go with it.`, { okLabel: 'Delete', danger: true }))) return;
    deleteEnvironment(id);
    if (selected === id) setSelected('globals');
  };

  const diffOptions = [
    { id: 'globals', name: 'Globals', variables: workspace.globals },
    ...workspace.environments.map((e) => ({ id: e.id, name: e.name, variables: e.variables })),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2.5 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Environments</span>
        <div className="flex items-center gap-0.5">
          {workspace.environments.length > 0 && (
            <IconButton label="Compare environments" onClick={() => setDiffOpen(true)}>
              <GitCompareArrows size={13} />
            </IconButton>
          )}
          <IconButton label="New environment" onClick={() => setSelected(addEnvironment())}>
            <Plus size={13} />
          </IconButton>
        </div>
      </div>
      <EnvironmentDiffModal open={diffOpen} onClose={() => setDiffOpen(false)} options={diffOptions} />

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
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-faint">Available in every workspace request — the weakest scope.</p>
              <Button size="sm" onClick={() => dotenvInput.current?.click()}>
                <FileUp size={12} /> Import .env…
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={workspace.globals} onChange={setGlobals} showDescription secretToggle />
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
            <div className="flex items-center justify-end">
              <Button size="sm" onClick={() => dotenvInput.current?.click()}>
                <FileUp size={12} /> Import .env…
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={current.variables} onChange={(variables) => updateEnvironment(current.id, { variables })} showDescription secretToggle />
            </div>
          </>
        ) : (
          <p className="text-[12px] text-faint">Select or create an environment.</p>
        )}
        <input
          ref={dotenvInput}
          type="file"
          accept=".env,text/plain"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const text = await file.text();
            if (selected === 'globals') {
              importDotenv(text, workspace.globals, setGlobals);
            } else if (current) {
              importDotenv(text, current.variables, (variables) => updateEnvironment(current.id, { variables }));
            }
          }}
        />
      </div>
    </div>
  );
}
