import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Folder, FolderTree, Pin, PinOff, Plug, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '@/store/session';
import { useActiveWorkspace, findCollection } from '@/store/workspaces';
import { locate } from '@/lib/tree';
import { methodVar } from '@/lib/methodColor';
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu';
import type { Tab } from '@/types';

export function TabBar() {
  const tabs = useSession((s) => s.tabs);
  const activeTabId = useSession((s) => s.activeTabId);
  const setActiveTab = useSession((s) => s.setActiveTab);
  const closeTab = useSession((s) => s.closeTab);
  const closeOtherTabs = useSession((s) => s.closeOtherTabs);
  const closeAllTabs = useSession((s) => s.closeAllTabs);
  const togglePinTab = useSession((s) => s.togglePinTab);
  const openTab = useSession((s) => s.openTab);
  const workspace = useActiveWorkspace();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeButtonRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // Pinned tabs sort first, otherwise the order the user opened them in — a
  // stable sort so pinning/unpinning never shuffles the rest of the row.
  const orderedTabs = useMemo(() => [...tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)), [tabs]);

  // With enough tabs open the strip scrolls, and the browser never scrolls a
  // newly-activated tab into view on its own — opening one past the visible
  // edge (or switching to one that's already off-screen) left it hidden past
  // the right edge, right where "+"/the close-tabs chevron are, looking like
  // the tab bar was stuck on the oldest tabs instead of following you.
  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  const displayName = (tab: Tab) => {
    if (tab.kind === 'collection') return findCollection(workspace, tab.collectionId)?.name ?? tab.name;
    if (tab.kind === 'folder') {
      const collection = findCollection(workspace, tab.collectionId);
      const found = collection && tab.nodeId ? locate(collection.items, tab.nodeId) : null;
      return found?.node.name ?? tab.name;
    }
    return tab.name;
  };

  const contextItems = (tab: Tab): MenuItem[] => [
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', icon: tab.pinned ? <PinOff size={12} /> : <Pin size={12} />, onSelect: () => togglePinTab(tab.id) },
    { label: 'Close', onSelect: () => closeTab(tab.id), separatorAbove: true },
    { label: 'Close others', onSelect: () => closeOtherTabs(tab.id) },
    { label: 'Close all', onSelect: closeAllTabs },
  ];

  return (
    <div className="flex items-stretch border-b border-line bg-surface-2">
      <div ref={scrollRef} className="no-scrollbar flex flex-1 overflow-x-auto">
        {orderedTabs.map((tab) => {
          const active = tab.id === activeTabId;
          const icon =
            tab.kind === 'ws' ? (
              <Plug size={11} className="shrink-0 text-info" />
            ) : tab.kind === 'grpc' || tab.kind === 'mqtt' ? (
              <span className="shrink-0 text-[9.5px] font-bold text-accent">{tab.kind === 'grpc' ? 'gRPC' : 'MQTT'}</span>
            ) : tab.kind === 'collection' ? (
              <FolderTree size={11} className="shrink-0 text-faint" />
            ) : tab.kind === 'folder' ? (
              <Folder size={11} className="shrink-0 text-faint" />
            ) : (
              <span className="shrink-0 text-[9.5px] font-bold" style={{ color: methodVar(tab.request.method) }}>
                {tab.request.method.slice(0, 4)}
              </span>
            );

          // A `<div role="button">`, not a real `<button>` — confirmed by a
          // user report that right-click did nothing here while it worked
          // everywhere else (e.g. the collection tree's rows, which are also
          // plain divs): WKWebView on macOS doesn't reliably deliver the
          // `contextmenu` event to native `<button>` elements, so a real
          // `<button>` here silently ate every right-click.
          return (
            <div
              key={tab.id}
              ref={active ? activeButtonRef : undefined}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveTab(tab.id);
                }
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, items: contextItems(tab) });
              }}
              title={tab.pinned ? displayName(tab) : undefined}
              className={clsx(
                'group flex h-9 shrink-0 cursor-default items-center gap-2 border-r border-line text-left',
                tab.pinned ? 'w-10 justify-center px-0' : 'min-w-[128px] max-w-[190px] px-3',
                active ? 'bg-bg' : 'bg-surface-2 hover:bg-surface-3',
              )}
            >
              {icon}
              {!tab.pinned && (
                <>
                  <span className={clsx('min-w-0 flex-1 truncate text-[12px]', active ? 'text-fg' : 'text-dim')}>{displayName(tab)}</span>
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
                </>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={() => openTab()} className="flex w-9 shrink-0 items-center justify-center text-faint hover:bg-surface-3 hover:text-fg" title="New tab (⌘T)">
        <Plus size={14} />
      </button>
      {tabs.length > 1 && (
        <button
          onClick={(e) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: 'Close other tabs', onSelect: () => activeTabId && closeOtherTabs(activeTabId) },
                { label: 'Close all tabs', onSelect: closeAllTabs },
              ],
            })
          }
          className="flex w-7 shrink-0 items-center justify-center border-l border-line text-faint hover:bg-surface-3 hover:text-fg"
          title="Close tabs…"
        >
          <ChevronDown size={13} />
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
