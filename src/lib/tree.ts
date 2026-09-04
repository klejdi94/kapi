import type { Collection, FolderNode, RequestNode, TreeNode } from '@/types';

export interface Located {
  node: TreeNode;
  /** null when the node sits directly on the collection. */
  parent: FolderNode | null;
  index: number;
}

export function locate(items: TreeNode[], id: string, parent: FolderNode | null = null): Located | null {
  for (let i = 0; i < items.length; i++) {
    const node = items[i];
    if (node.id === id) return { node, parent, index: i };
    if (node.type === 'folder') {
      const found = locate(node.items, id, node);
      if (found) return found;
    }
  }
  return null;
}

/** Rebuilds the tree with `fn` applied to the matching node. */
export function mapNode(items: TreeNode[], id: string, fn: (node: TreeNode) => TreeNode): TreeNode[] {
  return items.map((node) => {
    if (node.id === id) return fn(node);
    if (node.type === 'folder') return { ...node, items: mapNode(node.items, id, fn) };
    return node;
  });
}

export function removeNode(items: TreeNode[], id: string): TreeNode[] {
  return items
    .filter((node) => node.id !== id)
    .map((node) => (node.type === 'folder' ? { ...node, items: removeNode(node.items, id) } : node));
}

/** Inserts into `parentId`'s children (or the collection root when null). */
export function insertNode(items: TreeNode[], parentId: string | null, index: number, node: TreeNode): TreeNode[] {
  if (parentId === null) {
    const next = [...items];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return next;
  }
  return items.map((child) => {
    if (child.type !== 'folder') return child;
    if (child.id === parentId) {
      const next = [...child.items];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
      return { ...child, items: next, expanded: true };
    }
    return { ...child, items: insertNode(child.items, parentId, index, node) };
  });
}

export function walk(items: TreeNode[], fn: (node: TreeNode, ancestors: FolderNode[]) => void, ancestors: FolderNode[] = []) {
  for (const node of items) {
    fn(node, ancestors);
    if (node.type === 'folder') walk(node.items, fn, [...ancestors, node]);
  }
}

export function allRequests(collection: Collection): { node: RequestNode; path: string[] }[] {
  const out: { node: RequestNode; path: string[] }[] = [];
  walk(collection.items, (node, ancestors) => {
    if (node.type === 'request') out.push({ node, path: ancestors.map((a) => a.name) });
  });
  return out;
}

/** Folders that contain the node, outermost first — used for header/auth inheritance. */
export function ancestorsOf(items: TreeNode[], id: string): FolderNode[] {
  const chain: FolderNode[] = [];
  const search = (list: TreeNode[], trail: FolderNode[]): boolean => {
    for (const node of list) {
      if (node.id === id) {
        chain.push(...trail);
        return true;
      }
      if (node.type === 'folder' && search(node.items, [...trail, node])) return true;
    }
    return false;
  };
  search(items, []);
  return chain;
}

/** True when `maybeAncestorId` contains `nodeId` — guards illegal drag-drops. */
export function contains(items: TreeNode[], maybeAncestorId: string, nodeId: string): boolean {
  const found = locate(items, maybeAncestorId);
  if (!found || found.node.type !== 'folder') return false;
  return locate(found.node.items, nodeId) !== null;
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/** Sets `expanded` on every folder in the tree — the "expand all" / "collapse all" action. */
export function setAllExpanded(items: TreeNode[], expanded: boolean): TreeNode[] {
  return items.map((node) =>
    node.type === 'folder' ? { ...node, expanded, items: setAllExpanded(node.items, expanded) } : node,
  );
}

/** True if any folder anywhere in the tree is collapsed — used to pick which of the two actions to show. */
export function hasCollapsedFolder(items: TreeNode[]): boolean {
  return items.some((node) => node.type === 'folder' && (!node.expanded || hasCollapsedFolder(node.items)));
}

/** Fresh ids throughout, so a duplicated subtree never collides with the original. */
export function reidentify(node: TreeNode, makeId: () => string): TreeNode {
  if (node.type === 'folder') {
    return { ...node, id: makeId(), items: node.items.map((child) => reidentify(child, makeId)) };
  }
  return { ...node, id: makeId(), request: deepClone(node.request) } as TreeNode;
}
