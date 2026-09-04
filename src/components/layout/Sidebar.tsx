import { FolderPlus, Search } from 'lucide-react';
import { useState } from 'react';
import { WorkspaceSwitcher } from '@/components/sidebar/WorkspaceSwitcher';
import { CollectionTree } from '@/components/sidebar/CollectionTree';
import { EnvironmentsPanel } from '@/components/sidebar/EnvironmentsPanel';
import { HistoryPanel } from '@/components/sidebar/HistoryPanel';
import { GitPanel } from '@/components/git/GitPanel';
import { Segmented, IconButton } from '@/components/ui/primitives';
import { useSession, type SidebarPanel } from '@/store/session';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { allRequests } from '@/lib/tree';
import { methodVar } from '@/lib/methodColor';

export function Sidebar({ onOpenImport, onOpenExport }: { onOpenImport: () => void; onOpenExport: () => void }) {
  const panel = useSession((s) => s.sidebarPanel);
  const setPanel = useSession((s) => s.set);
  const workspace = useActiveWorkspace();
  const addCollection = useWorkspaces((s) => s.addCollection);
  const openRequestNode = useSession((s) => s.openRequestNode);
  const [query, setQuery] = useState('');

  const searching = panel === 'collections' && query.trim().length > 0;
  const searchResults = searching
    ? workspace.collections.flatMap((c) =>
        allRequests(c)
          .filter((r) => r.node.name.toLowerCase().includes(query.toLowerCase()) || r.node.request.url.toLowerCase().includes(query.toLowerCase()))
          .map((r) => ({ ...r, collection: c })),
      )
    : [];

  return (
    <div className="flex h-full flex-col bg-surface-2">
      <WorkspaceSwitcher onOpenImport={onOpenImport} onOpenExport={onOpenExport} />

      <div className="flex items-center justify-between gap-1 border-b border-line px-2 py-1.5">
        <Segmented
          value={panel}
          onChange={(v) => setPanel('sidebarPanel', v as SidebarPanel)}
          options={[
            { value: 'collections', label: 'Collections' },
            { value: 'environments', label: 'Env' },
            { value: 'history', label: 'History' },
            { value: 'git', label: 'Git' },
          ]}
        />
        {panel === 'collections' && (
          <IconButton label="New collection" onClick={() => addCollection()}>
            <FolderPlus size={13} />
          </IconButton>
        )}
      </div>

      {panel === 'collections' && (
        <div className="border-b border-line px-2 py-1.5">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search requests…"
              className="h-7 w-full rounded-md border border-line bg-surface pl-6.5 pr-2 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {panel === 'collections' &&
          (searching ? (
            <div className="p-1.5">
              {searchResults.length === 0 && <p className="px-2 py-2 text-[12px] text-faint">No matches.</p>}
              {searchResults.map(({ node, collection, path }) => (
                <button
                  key={node.id}
                  onClick={() => openRequestNode({ nodeId: node.id, collectionId: collection.id, name: node.name, request: node.request })}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-surface-3"
                >
                  <span className="w-9 shrink-0 text-right text-[9.5px] font-bold" style={{ color: methodVar(node.request.method) }}>
                    {node.request.method.slice(0, 4)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-fg">{node.name}</div>
                    <div className="truncate text-[10.5px] text-faint">{[collection.name, ...path].join(' / ')}</div>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-1.5">
              {workspace.collections.length === 0 && (
                <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">No collections yet. Create one to start organizing requests.</p>
              )}
              {workspace.collections.map((c) => (
                <CollectionTree key={c.id} collection={c} />
              ))}
            </div>
          ))}
        {panel === 'environments' && <EnvironmentsPanel />}
        {panel === 'history' && <HistoryPanel />}
        {panel === 'git' && <GitPanel />}
      </div>
    </div>
  );
}
