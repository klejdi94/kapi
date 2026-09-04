import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Download, FolderInput, FolderOutput, Import, Plus, Settings2, Trash2 } from 'lucide-react';
import { useWorkspaces } from '@/store/workspaces';
import { IconButton } from '@/components/ui/primitives';
import { toast } from '@/lib/toast';
import { gitAvailable, pickFolder } from '@/lib/git';
import { readSnapshot, writeSnapshotTo } from '@/lib/gitWorkspace';
import { newWorkspace } from '@/lib/factory';

const ICON_CHOICES = ['🚀', '🔧', '⚡', '🛠️', '📦', '🌐', '🔒', '🧪', '💾', '🎯', '🐙', '🔥', '📡', '🧩', '🗂️', '🎨'];

export function WorkspaceSwitcher({ onOpenImport, onOpenExport }: { onOpenImport: () => void; onOpenExport: () => void }) {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeWorkspaceId);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const setActive = useWorkspaces((s) => s.setActiveWorkspace);
  const addWorkspace = useWorkspaces((s) => s.addWorkspace);
  const importWorkspace = useWorkspaces((s) => s.importWorkspace);
  const deleteWorkspace = useWorkspaces((s) => s.deleteWorkspace);
  const renameWorkspace = useWorkspaces((s) => s.renameWorkspace);
  const setWorkspaceIcon = useWorkspaces((s) => s.setWorkspaceIcon);

  const [open, setOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!iconPickerOpen) return;
    const close = (e: MouseEvent) => {
      if (iconRef.current && !iconRef.current.contains(e.target as Node)) setIconPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [iconPickerOpen]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const saveToFolder = async () => {
    if (!active) return;
    const folder = await pickFolder();
    if (!folder) return;
    await writeSnapshotTo(active, folder);
    toast.success('Saved to folder', folder);
    setOpen(false);
  };

  const importFromFolder = async () => {
    const folder = await pickFolder();
    if (!folder) return;
    const snapshot = await readSnapshot(folder);
    if (!snapshot) {
      toast.error('No kapi workspace found there', 'Expected a kapi-workspace.json file in that folder.');
      return;
    }
    const ws = newWorkspace(snapshot.name);
    ws.collections = snapshot.collections;
    importWorkspace(ws);
    toast.success('Imported workspace', `${snapshot.name} — ${snapshot.collections.length} collection(s)`);
    setOpen(false);
  };

  return (
    <div className="relative border-b border-line p-2" ref={ref}>
      <div className="flex h-9 w-full items-center gap-2 rounded-md px-2 hover:bg-surface-2">
        <div className="relative shrink-0" ref={iconRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIconPickerOpen((o) => !o);
            }}
            title="Choose an icon"
            className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[13px] font-bold text-accent-fg hover:brightness-110"
          >
            {active?.icon || (active?.name || 'K').slice(0, 1).toUpperCase()}
          </button>
          {iconPickerOpen && (
            <div
              className="animate-in absolute left-0 top-[calc(100%+4px)] z-40 grid w-48 grid-cols-6 gap-1 rounded-lg border border-line bg-surface-2 p-2 shadow-2xl"
              style={{ boxShadow: 'var(--shadow)' }}
            >
              {ICON_CHOICES.map((icon) => (
                <button
                  key={icon}
                  onClick={() => {
                    setWorkspaceIcon(icon);
                    setIconPickerOpen(false);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-[15px] hover:bg-surface-3"
                >
                  {icon}
                </button>
              ))}
              {active?.icon && (
                <button
                  onClick={() => {
                    setWorkspaceIcon('');
                    setIconPickerOpen(false);
                  }}
                  className="col-span-6 mt-1 rounded border-t border-line pt-1.5 text-[11px] text-faint hover:text-fg"
                >
                  Reset to letter
                </button>
              )}
            </div>
          )}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{active?.name || 'Workspace'}</span>
          <ChevronsUpDown size={13} className="shrink-0 text-faint" />
        </button>
      </div>

      {open && (
        <div className="animate-in absolute left-2 right-2 top-[calc(100%+2px)] z-30 overflow-hidden rounded-lg border border-line bg-surface-2 shadow-2xl" style={{ boxShadow: 'var(--shadow)' }}>
          <div className="max-h-64 overflow-y-auto py-1">
            {workspaces.map((ws) => (
              <div key={ws.id} className="group flex items-center gap-1 px-1">
                {editingId === ws.id ? (
                  <input
                    autoFocus
                    defaultValue={ws.name}
                    onBlur={(e) => {
                      renameWorkspace(ws.id, e.target.value.trim() || ws.name);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="my-0.5 h-7 flex-1 rounded border border-accent bg-surface px-2 text-[12.5px] focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setActive(ws.id);
                      setOpen(false);
                    }}
                    className="flex h-8 flex-1 items-center gap-2 rounded px-2 text-left text-[12.5px] hover:bg-surface-3"
                  >
                    <Check size={13} className={ws.id === activeId ? 'text-accent' : 'text-transparent'} />
                    <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                    <span className="text-[10.5px] text-faint">{ws.collections.length}</span>
                  </button>
                )}
                <div className="flex shrink-0 opacity-0 group-hover:opacity-100">
                  <IconButton label="Rename" onClick={() => setEditingId(ws.id)}>
                    <Settings2 size={12} />
                  </IconButton>
                  <IconButton
                    label="Delete workspace"
                    tone="danger"
                    onClick={() => {
                      if (workspaces.length <= 1) {
                        toast.warn('Can’t delete the only workspace');
                        return;
                      }
                      if (confirm(`Delete workspace "${ws.name}"? This cannot be undone.`)) deleteWorkspace(ws.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-line p-1">
            <button
              onClick={() => {
                addWorkspace();
                setOpen(false);
              }}
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12.5px] text-dim hover:bg-surface-3 hover:text-fg"
            >
              <Plus size={13} /> New workspace
            </button>
            <button
              onClick={() => {
                onOpenImport();
                setOpen(false);
              }}
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12.5px] text-dim hover:bg-surface-3 hover:text-fg"
            >
              <Import size={13} /> Import…
            </button>
            <button
              onClick={() => {
                onOpenExport();
                setOpen(false);
              }}
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12.5px] text-dim hover:bg-surface-3 hover:text-fg"
            >
              <Download size={13} /> Export workspace…
            </button>
            {gitAvailable() && (
              <>
                <div className="my-1 border-t border-line" />
                <button
                  onClick={saveToFolder}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12.5px] text-dim hover:bg-surface-3 hover:text-fg"
                >
                  <FolderOutput size={13} /> Save to folder…
                </button>
                <button
                  onClick={importFromFolder}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[12.5px] text-dim hover:bg-surface-3 hover:text-fg"
                >
                  <FolderInput size={13} /> Import from folder…
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
