import { useState } from 'react';
import {
  ChevronRight, Copy, Download, FilePlus, FolderPlus, MoreHorizontal, Pencil, Play, Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Collection, FolderNode, RequestNode, TreeNode } from '@/types';
import { methodVar } from '@/lib/methodColor';
import { newFolder, newRequestNode } from '@/lib/factory';
import { useWorkspaces } from '@/store/workspaces';
import { useSession } from '@/store/session';
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu';
import { toast } from '@/lib/toast';
import { contains } from '@/lib/tree';

interface DragState {
  collectionId: string;
  nodeId: string;
}

export function CollectionTree({ collection }: { collection: Collection }) {
  const updateCollection = useWorkspaces((s) => s.updateCollection);
  const deleteCollection = useWorkspaces((s) => s.deleteCollection);
  const restoreCollection = useWorkspaces((s) => s.restoreCollection);
  const addNode = useWorkspaces((s) => s.addNode);
  const deleteNode = useWorkspaces((s) => s.deleteNode);
  const duplicateNode = useWorkspaces((s) => s.duplicateNode);
  const updateNode = useWorkspaces((s) => s.updateNode);
  const moveNode = useWorkspaces((s) => s.moveNode);
  const openRequestNode = useSession((s) => s.openRequestNode);

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; where: 'before' | 'after' | 'inside' } | null>(null);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const openRequest = (node: RequestNode) =>
    openRequestNode({ nodeId: node.id, collectionId: collection.id, name: node.name, request: node.request });

  const handleDrop = (targetId: string | null, where: 'before' | 'after' | 'inside') => {
    if (!drag) return;
    if (targetId && drag.nodeId === targetId) return;
    if (targetId && contains(collection.items, drag.nodeId, targetId)) return; // can't drop a folder into itself

    let parentFolderId: string | null;
    let index: number;

    if (where === 'inside') {
      parentFolderId = targetId;
      index = Number.MAX_SAFE_INTEGER;
    } else {
      const flat = flatten(collection.items);
      const targetIndex = flat.findIndex((f) => f.node.id === targetId);
      const target = flat[targetIndex];
      parentFolderId = target?.parentId ?? null;
      const siblingIds = flat.filter((f) => f.parentId === parentFolderId).map((f) => f.node.id);
      const pos = siblingIds.indexOf(targetId!);
      index = where === 'before' ? pos : pos + 1;
    }

    moveNode({ collectionId: drag.collectionId, nodeId: drag.nodeId }, { collectionId: collection.id, parentFolderId, index });
    setDrag(null);
    setDropTarget(null);
  };

  return (
    <div
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        // Dropped on empty space below the tree: append to root.
        if (!dropTarget) handleDrop(null, 'inside');
      }}
    >
      <div className="group flex items-center gap-1 px-1 py-0.5">
        <button
          onClick={() => updateCollection(collection.id, { expanded: !collection.expanded })}
          className="flex h-6 flex-1 items-center gap-1 rounded px-1 text-left hover:bg-surface-2"
          onContextMenu={(e) =>
            openMenu(e, [
              { label: 'New request', icon: <FilePlus size={12} />, onSelect: () => addNode(collection.id, null, newRequestNode()) },
              { label: 'New folder', icon: <FolderPlus size={12} />, onSelect: () => addNode(collection.id, null, newFolder()) },
              { label: 'Rename', icon: <Pencil size={12} />, onSelect: () => setRenaming(collection.id), separatorAbove: true },
              { label: 'Export collection', icon: <Download size={12} />, onSelect: () => window.dispatchEvent(new CustomEvent('kapi:export-collection', { detail: collection.id })) },
              {
                label: 'Delete collection', icon: <Trash2 size={12} />, danger: true, separatorAbove: true,
                onSelect: () => {
                  const removed = deleteCollection(collection.id);
                  if (removed) {
                    const ws = useWorkspaces.getState();
                    const index = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId)?.collections.length ?? 0;
                    toast.undo(`Deleted "${collection.name}"`, () => restoreCollection(removed, index));
                  }
                },
              },
            ])
          }
        >
          <ChevronRight size={13} className={clsx('shrink-0 text-faint transition-transform', collection.expanded && 'rotate-90')} />
          {renaming === collection.id ? (
            <RenameInput value={collection.name} onCommit={(name) => { updateCollection(collection.id, { name }); setRenaming(null); }} onCancel={() => setRenaming(null)} />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg">{collection.name}</span>
          )}
        </button>
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
          onClick={(e) =>
            openMenu(e, [
              { label: 'New request', icon: <FilePlus size={12} />, onSelect: () => addNode(collection.id, null, newRequestNode()) },
              { label: 'New folder', icon: <FolderPlus size={12} />, onSelect: () => addNode(collection.id, null, newFolder()) },
            ])
          }
        >
          <MoreHorizontal size={13} />
        </button>
      </div>

      {collection.expanded && (
        <div className="pl-2.5">
          {collection.items.length === 0 && (
            <p className="px-3 py-1.5 text-[11.5px] text-faint">Empty — right-click to add a request.</p>
          )}
          {collection.items.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              depth={0}
              collection={collection}
              renaming={renaming}
              setRenaming={setRenaming}
              openMenu={openMenu}
              openRequest={openRequest}
              addNode={addNode}
              deleteNode={deleteNode}
              duplicateNode={duplicateNode}
              updateNode={updateNode}
              drag={drag}
              setDrag={setDrag}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function flatten(items: TreeNode[], parentId: string | null = null): { node: TreeNode; parentId: string | null }[] {
  return items.flatMap((node) => [{ node, parentId }, ...(node.type === 'folder' ? flatten(node.items, node.id) : [])]);
}

function RenameInput({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  return (
    <input
      autoFocus
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value.trim() || value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onCancel();
      }}
      className="h-6 flex-1 rounded border border-accent bg-surface px-1.5 text-[12.5px] focus:outline-none"
    />
  );
}

function NodeRow({
  node,
  depth,
  collection,
  renaming,
  setRenaming,
  openMenu,
  openRequest,
  addNode,
  deleteNode,
  duplicateNode,
  updateNode,
  drag,
  setDrag,
  dropTarget,
  setDropTarget,
  onDrop,
}: {
  node: TreeNode;
  depth: number;
  collection: Collection;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  openRequest: (node: RequestNode) => void;
  addNode: ReturnType<typeof useWorkspaces.getState>['addNode'];
  deleteNode: ReturnType<typeof useWorkspaces.getState>['deleteNode'];
  duplicateNode: ReturnType<typeof useWorkspaces.getState>['duplicateNode'];
  updateNode: ReturnType<typeof useWorkspaces.getState>['updateNode'];
  drag: DragState | null;
  setDrag: (d: DragState | null) => void;
  dropTarget: { id: string; where: 'before' | 'after' | 'inside' } | null;
  setDropTarget: (t: { id: string; where: 'before' | 'after' | 'inside' } | null) => void;
  onDrop: (targetId: string | null, where: 'before' | 'after' | 'inside') => void;
}) {
  const activeTabId = useSession((s) => s.activeTabId);
  const tabs = useSession((s) => s.tabs);
  const isOpen = node.type === 'request' && tabs.some((t) => t.id === activeTabId && t.nodeId === node.id);

  const commonMenuItems = (): MenuItem[] => [
    { label: 'Rename', icon: <Pencil size={12} />, onSelect: () => setRenaming(node.id) },
    { label: 'Duplicate', icon: <Copy size={12} />, onSelect: () => duplicateNode(collection.id, node.id) },
    {
      label: 'Delete', icon: <Trash2 size={12} />, danger: true, separatorAbove: true,
      onSelect: () => {
        const removed = deleteNode(collection.id, node.id);
        if (removed) {
          toast.undo(`Deleted "${node.name}"`, () =>
            addNode(collection.id, removed.parentId, removed.node),
          );
        }
      },
    },
  ];

  const onRowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const where = dropTarget?.id === node.id ? dropTarget.where : 'after';
    onDrop(node.id, where);
  };

  const onDragOverRow = (e: React.DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;
    const where = node.type === 'folder' && relY > 0.25 && relY < 0.75 ? 'inside' : relY < 0.5 ? 'before' : 'after';
    setDropTarget({ id: node.id, where });
  };

  const dropLine =
    dropTarget?.id === node.id && dropTarget.where !== 'inside' ? (
      <div className={clsx('absolute inset-x-2 h-0.5 rounded bg-accent', dropTarget.where === 'before' ? '-top-px' : '-bottom-px')} />
    ) : null;

  if (node.type === 'folder') {
    const folder = node as FolderNode;
    return (
      <div className="relative">
        {dropLine}
        <div
          draggable
          onDragStart={() => setDrag({ collectionId: collection.id, nodeId: node.id })}
          onDragEnd={() => { setDrag(null); setDropTarget(null); }}
          onDragOver={onDragOverRow}
          onDrop={onRowDrop}
          className={clsx(
            'group flex min-w-0 items-center gap-1 rounded py-0.5 pr-1 hover:bg-surface-2',
            dropTarget?.id === node.id && dropTarget.where === 'inside' && 'bg-accent/10 ring-1 ring-inset ring-accent/40',
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button
            onClick={() => updateNode(collection.id, node.id, { expanded: !folder.expanded })}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: 'New request', icon: <FilePlus size={12} />, onSelect: () => addNode(collection.id, node.id, newRequestNode()) },
                { label: 'New folder', icon: <FolderPlus size={12} />, onSelect: () => addNode(collection.id, node.id, newFolder()) },
                ...commonMenuItems(),
              ])
            }
            className="flex h-6.5 flex-1 items-center gap-1 text-left"
          >
            <ChevronRight size={12} className={clsx('shrink-0 text-faint transition-transform', folder.expanded && 'rotate-90')} />
            {renaming === node.id ? (
              <RenameInput value={node.name} onCommit={(name) => { updateNode(collection.id, node.id, { name }); setRenaming(null); }} onCancel={() => setRenaming(null)} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{folder.name}</span>
            )}
          </button>
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:bg-surface-3 group-hover:opacity-100"
            onClick={(e) => openMenu(e, commonMenuItems())}
          >
            <MoreHorizontal size={12} />
          </button>
        </div>
        {folder.expanded &&
          folder.items.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collection={collection}
              renaming={renaming}
              setRenaming={setRenaming}
              openMenu={openMenu}
              openRequest={openRequest}
              addNode={addNode}
              deleteNode={deleteNode}
              duplicateNode={duplicateNode}
              updateNode={updateNode}
              drag={drag}
              setDrag={setDrag}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDrop={onDrop}
            />
          ))}
      </div>
    );
  }

  const req = node as RequestNode;
  return (
    <div className="relative">
      {dropLine}
      <div
        draggable
        onDragStart={() => setDrag({ collectionId: collection.id, nodeId: node.id })}
        onDragEnd={() => { setDrag(null); setDropTarget(null); }}
        onDragOver={onDragOverRow}
        onDrop={onRowDrop}
        onContextMenu={(e) => openMenu(e, [{ label: 'Send', icon: <Play size={12} />, onSelect: () => openRequest(req) }, ...commonMenuItems()])}
        onClick={() => openRequest(req)}
        className={clsx('group flex h-6.5 min-w-0 cursor-pointer items-center gap-1.5 rounded pr-1 hover:bg-surface-2', isOpen && 'bg-surface-2')}
        style={{ paddingLeft: 4 + (depth + 1) * 14 }}
      >
        <span className="w-9 shrink-0 text-right text-[9.5px] font-bold" style={{ color: methodVar(req.request.method) }}>
          {req.request.method.length > 6 ? req.request.method.slice(0, 4) : req.request.method}
        </span>
        {renaming === node.id ? (
          <RenameInput value={node.name} onCommit={(name) => { updateNode(collection.id, node.id, { name }); setRenaming(null); }} onCancel={() => setRenaming(null)} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-dim group-hover:text-fg">{req.name}</span>
        )}
        <button
          className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:bg-surface-3 group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); openMenu(e, commonMenuItems()); }}
        >
          <MoreHorizontal size={11} />
        </button>
      </div>
    </div>
  );
}
