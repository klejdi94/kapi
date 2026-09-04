import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, FilePlus, Import, Moon, Search, Sun } from 'lucide-react';
import { useSession } from '@/store/session';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { allRequests } from '@/lib/tree';
import { methodVar } from '@/lib/methodColor';
import { toggleTheme } from '@/lib/theme';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  extraCommands,
}: {
  open: boolean;
  onClose: () => void;
  extraCommands: Command[];
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const workspace = useActiveWorkspace();
  const workspaces = useWorkspaces((s) => s.workspaces);
  const setActiveWorkspace = useWorkspaces((s) => s.setActiveWorkspace);
  const openRequestNode = useSession((s) => s.openRequestNode);
  const openTab = useSession((s) => s.openTab);
  const theme = useSession((s) => s.theme);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const staticCommands: Command[] = useMemo(
    () => [
      { id: 'new-tab', label: 'New request tab', icon: <FilePlus size={13} />, run: () => openTab() },
      {
        id: 'toggle-theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />,
        run: toggleTheme,
      },
      ...extraCommands,
      ...workspaces
        .filter((w) => w.id !== workspace.id)
        .map((w) => ({ id: `ws-${w.id}`, label: `Switch to workspace "${w.name}"`, icon: <Import size={13} />, run: () => setActiveWorkspace(w.id) })),
    ],
    [theme, extraCommands, workspaces, workspace.id, openTab, setActiveWorkspace],
  );

  const requestResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return workspace.collections.flatMap((c) =>
      allRequests(c)
        .filter((r) => r.node.name.toLowerCase().includes(q) || r.node.request.url.toLowerCase().includes(q))
        .map((r) => ({ ...r, collection: c })),
    ).slice(0, 30);
  }, [workspace, query]);

  const filteredCommands = useMemo(
    () => (query.trim() ? staticCommands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : staticCommands),
    [staticCommands, query],
  );

  const flat: { kind: 'command' | 'request'; run: () => void; render: React.ReactNode }[] = [
    ...filteredCommands.map((c) => ({
      kind: 'command' as const,
      run: () => { c.run(); onClose(); },
      render: (
        <div className="flex items-center gap-2.5 px-3 py-2">
          <span className="flex h-5 w-5 items-center justify-center text-faint">{c.icon}</span>
          <span className="text-[12.5px] text-fg">{c.label}</span>
        </div>
      ),
    })),
    ...requestResults.map((r) => ({
      kind: 'request' as const,
      run: () => {
        openRequestNode({ nodeId: r.node.id, collectionId: r.collection.id, name: r.node.name, request: r.node.request });
        onClose();
      },
      render: (
        <div className="flex items-center gap-2.5 px-3 py-2">
          <span className="w-9 shrink-0 text-right text-[9.5px] font-bold" style={{ color: methodVar(r.node.request.method) }}>
            {r.node.request.method.slice(0, 4)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] text-fg">{r.node.name}</div>
            <div className="truncate text-[10.5px] text-faint">{[r.collection.name, ...r.path].join(' / ')}</div>
          </div>
        </div>
      ),
    })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, flat.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        flat[index]?.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, index, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/40 pt-[14vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <div
        className="animate-in flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-surface-2 shadow-2xl"
        style={{ boxShadow: 'var(--shadow)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={14} className="text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            placeholder="Search requests, or run a command…"
            className="h-11 flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none"
          />
          <span className="flex items-center gap-1 text-[10.5px] text-faint">
            <CornerDownLeft size={11} /> select
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {flat.length === 0 && <p className="px-3 py-6 text-center text-[12px] text-faint">No results.</p>}
          {flat.map((item, i) => (
            <div key={i} onClick={item.run} onMouseEnter={() => setIndex(i)} className={i === index ? 'cursor-pointer bg-surface-3' : 'cursor-pointer'}>
              {item.render}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

