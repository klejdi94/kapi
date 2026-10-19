import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import type { Collection, FolderNode } from '@/types';
import { Segmented, Button } from '@/components/ui/primitives';
import { AuthTab } from '@/components/request/AuthTab';
import { HeadersTab } from '@/components/request/HeadersTab';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { useRunner } from '@/store/runner';
import { countByType } from '@/lib/tree';
import { buildScope } from '@/lib/variables';

type DetailTab = 'overview' | 'auth' | 'headers';

/**
 * A folder's own small home page — same idea as `CollectionDetailPage` but
 * scoped to what a folder actually carries: default Auth and Headers for
 * everything under it, neither of which had any UI before this.
 */
export function FolderDetailPage({ collection, folder }: { collection: Collection; folder: FolderNode }) {
  const workspace = useActiveWorkspace();
  const updateNode = useWorkspaces((s) => s.updateNode);
  const scope = buildScope(workspace, collection);
  const [tab, setTab] = useState<DetailTab>('overview');

  const { requests: requestCount, folders: folderCount, websockets: wsCount, grpc: grpcCount } = countByType(folder.items);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <input
          value={folder.name}
          onChange={(e) => updateNode(collection.id, folder.id, { name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-fg focus:outline-none"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => useRunner.getState().openFor(collection.id, folder.id)}>
            <ListChecks size={13} /> Run
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[11px] text-faint">
        <span>in {collection.name}</span>
        <span>·</span>
        <span>
          {requestCount} request{requestCount === 1 ? '' : 's'}
        </span>
        <span>·</span>
        <span>
          {folderCount} folder{folderCount === 1 ? '' : 's'}
        </span>
        {wsCount > 0 && (
          <>
            <span>·</span>
            <span>
              {wsCount} websocket{wsCount === 1 ? '' : 's'}
            </span>
          </>
        )}
        {grpcCount > 0 && (
          <>
            <span>·</span>
            <span>
              {grpcCount} gRPC
            </span>
          </>
        )}
      </div>

      <div className="border-b border-line px-4 py-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'auth', label: 'Auth', dot: folder.auth.type !== 'none' },
            { value: 'headers', label: 'Headers', count: folder.headers.filter((h) => h.enabled && h.key.trim()).length },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="max-w-2xl p-4">
            <p className="text-[11.5px] leading-relaxed text-faint">
              Every request in this folder inherits its Auth and Headers by default — set to &ldquo;Inherit&rdquo; to
              fall back to {collection.name}&rsquo;s own instead.
            </p>
          </div>
        )}

        {tab === 'auth' && (
          <AuthTab
            auth={folder.auth}
            onChange={(auth) => updateNode(collection.id, folder.id, { auth })}
            inheritedFrom={`collection "${collection.name}"`}
            warning={null}
            canInherit
            scope={scope}
          />
        )}

        {tab === 'headers' && (
          <HeadersTab
            headers={folder.headers}
            autoHeaders={[]}
            onChange={(headers) => updateNode(collection.id, folder.id, { headers })}
            resolve={(text) => text}
          />
        )}
      </div>
    </div>
  );
}
