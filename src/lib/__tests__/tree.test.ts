import { describe, it, expect } from 'vitest';
import { locate, insertNode, removeNode, contains, countByType, reidentify, mapNode, allRequests, ancestorsOf } from '../tree';
import { newFolder, newRequestNode } from '../factory';
import type { TreeNode } from '@/types';

function sampleTree(): TreeNode[] {
  const child = newRequestNode('Child request');
  const inner = newFolder('Inner');
  inner.items = [child];
  const outer = newFolder('Outer');
  outer.items = [inner, newRequestNode('Sibling')];
  return [outer];
}

describe('locate', () => {
  it('finds a deeply nested node and its parent/index', () => {
    const tree = sampleTree();
    const inner = (tree[0] as any).items[0];
    const child = inner.items[0];
    const found = locate(tree, child.id);
    expect(found?.node.id).toBe(child.id);
    expect(found?.parent?.id).toBe(inner.id);
    expect(found?.index).toBe(0);
  });

  it('returns null for an id that does not exist', () => {
    expect(locate(sampleTree(), 'nope')).toBeNull();
  });
});

describe('insertNode / removeNode', () => {
  it('inserts at the root when parentId is null', () => {
    const tree = sampleTree();
    const node = newRequestNode('New');
    const next = insertNode(tree, null, 0, node);
    expect(next[0].id).toBe(node.id);
    expect(next).toHaveLength(2);
  });

  it('inserts inside a named folder', () => {
    const tree = sampleTree();
    const outerId = tree[0].id;
    const node = newRequestNode('New');
    const next = insertNode(tree, outerId, 0, node);
    expect((next[0] as any).items[0].id).toBe(node.id);
  });

  it('removes a node wherever it is nested', () => {
    const tree = sampleTree();
    const inner = (tree[0] as any).items[0];
    const child = inner.items[0];
    const next = removeNode(tree, child.id);
    expect(locate(next, child.id)).toBeNull();
  });
});

describe('contains', () => {
  it('is true when a folder contains a node at any depth', () => {
    const tree = sampleTree();
    const outer = tree[0];
    const inner = (outer as any).items[0];
    const child = inner.items[0];
    expect(contains(tree, outer.id, child.id)).toBe(true);
  });

  it('is false for a non-folder or unrelated node', () => {
    const tree = sampleTree();
    const sibling = (tree[0] as any).items[1];
    expect(contains(tree, sibling.id, tree[0].id)).toBe(false);
  });
});

describe('countByType', () => {
  it('tallies requests, folders and websockets at every depth', () => {
    const tree = sampleTree();
    expect(countByType(tree)).toEqual({ requests: 2, folders: 2, websockets: 0, grpc: 0 });
  });
});

describe('reidentify', () => {
  it('gives every node in a subtree a fresh id, recursively', () => {
    const tree = sampleTree();
    const outer = tree[0] as any;
    let n = 0;
    const copy = reidentify(outer, () => `fresh-${n++}`) as any;
    expect(copy.id).not.toBe(outer.id);
    expect(copy.items[0].id).not.toBe(outer.items[0].id);
    expect(copy.items[0].items[0].id).not.toBe(outer.items[0].items[0].id);
  });
});

describe('mapNode', () => {
  it('applies fn only to the matching node, anywhere in the tree', () => {
    const tree = sampleTree();
    const child = (tree[0] as any).items[0].items[0];
    const next = mapNode(tree, child.id, (n) => ({ ...n, name: 'Renamed' }));
    const found = locate(next, child.id);
    expect(found?.node.name).toBe('Renamed');
  });
});

describe('allRequests / ancestorsOf', () => {
  it('lists every request with the folder path above it', () => {
    const tree = sampleTree();
    const collection = { items: tree } as any;
    const results = allRequests(collection);
    expect(results.map((r) => r.node.name).sort()).toEqual(['Child request', 'Sibling']);
    const childResult = results.find((r) => r.node.name === 'Child request')!;
    expect(childResult.path).toEqual(['Outer', 'Inner']);
  });

  it('returns the folder chain above a node, outermost first', () => {
    const tree = sampleTree();
    const child = (tree[0] as any).items[0].items[0];
    const chain = ancestorsOf(tree, child.id);
    expect(chain.map((f) => f.name)).toEqual(['Outer', 'Inner']);
  });
});
