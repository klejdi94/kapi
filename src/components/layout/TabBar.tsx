import { useRef } from 'react';
import { Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '@/store/session';
import { methodVar } from '@/lib/methodColor';
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu';
import { useState } from 'react';

export function TabBar() {
  const tabs = useSession((s) => s.tabs);
  const activeTabId = useSession((s) => s.activeTabId);
  const setActiveTab = useSession((s) => s.setActiveTab);
  const closeTab = useSession((s) => s.closeTab);
  const closeOtherTabs = useSession((s) => s.closeOtherTabs);
  const closeAllTabs = useSession((s) => s.closeAllTabs);
  const openTab = useSession((s) => s.openTab);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  return (
    <div className="flex items-stretch border-b border-line bg-surface-2">
      <div ref={scrollRef} className="no-scrollbar flex flex-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: 'Close', onSelect: () => closeTab(tab.id) },
                    { label: 'Close others', onSelect: () => closeOtherTabs(tab.id) },
                    { label: 'Close all', onSelect: closeAllTabs },
                  ],
                });
              }}
              className={clsx(
                'group flex h-9 min-w-[128px] max-w-[190px] shrink-0 items-center gap-2 border-r border-line px-3 text-left',
                active ? 'bg-bg' : 'bg-surface-2 hover:bg-surface-3',
              )}
            >
              <span className="shrink-0 text-[9.5px] font-bold" style={{ color: methodVar(tab.request.method) }}>
                {tab.request.method.slice(0, 4)}
              </span>
              <span className={clsx('min-w-0 flex-1 truncate text-[12px]', active ? 'text-fg' : 'text-dim')}>{tab.name}</span>
              {tab.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:bg-surface-3 hover:text-fg group-hover:opacity-100"
              >
                <X size={11} />
              </span>
            </button>
          );
        })}
      </div>
      <button onClick={() => openTab()} className="flex w-9 shrink-0 items-center justify-center text-faint hover:bg-surface-3 hover:text-fg" title="New tab (⌘T)">
        <Plus size={14} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
