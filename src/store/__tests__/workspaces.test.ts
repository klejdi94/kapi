import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaces, activeWorkspace } from '../workspaces';
import { newWorkspace, newCollection, newRequestNode } from '../../lib/factory';

function resetToWorkspace() {
  const ws = newWorkspace('W');
  useWorkspaces.setState({ workspaces: [ws], activeWorkspaceId: ws.id });
  return ws;
}

describe('duplicateCollection', () => {
  beforeEach(() => resetToWorkspace());

  it('creates a copy with a fresh id, " copy" suffix, and fresh ids throughout the tree', () => {
    const ws = activeWorkspace(useWorkspaces.getState());
    const collection = newCollection('Original');
    collection.items = [newRequestNode('Req')];
    useWorkspaces.setState({ workspaces: [{ ...ws, collections: [collection] }] });

    const newId = useWorkspaces.getState().duplicateCollection(collection.id);
    const collections = activeWorkspace(useWorkspaces.getState()).collections;
    expect(collections).toHaveLength(2);
    const copy = collections.find((c) => c.id === newId)!;
    expect(copy.name).toBe('Original copy');
    expect(copy.id).not.toBe(collection.id);
    expect(copy.items[0].id).not.toBe(collection.items[0].id);
  });

  it('returns null for a collection that does not exist', () => {
    expect(useWorkspaces.getState().duplicateCollection('nope')).toBeNull();
  });
});

describe('cookie jar actions', () => {
  beforeEach(() => resetToWorkspace());

  it('addCookies merges by name+domain+path and drops expired ones', () => {
    const { addCookies } = useWorkspaces.getState();
    addCookies([{ name: 'a', value: '1', domain: 'x.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 0 }]);
    addCookies([{ name: 'a', value: '2', domain: 'x.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 1 }]);
    const cookies = activeWorkspace(useWorkspaces.getState()).cookies;
    expect(cookies).toHaveLength(1);
    expect(cookies[0].value).toBe('2');
  });

  it('deleteCookie removes only the matching one', () => {
    const { addCookies, deleteCookie } = useWorkspaces.getState();
    addCookies([
      { name: 'a', value: '1', domain: 'x.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 0 },
      { name: 'b', value: '2', domain: 'x.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 0 },
    ]);
    deleteCookie('a', 'x.com', '/');
    const cookies = activeWorkspace(useWorkspaces.getState()).cookies;
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('b');
  });

  it('clearCookies empties the jar', () => {
    const { addCookies, clearCookies } = useWorkspaces.getState();
    addCookies([{ name: 'a', value: '1', domain: 'x.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 0 }]);
    clearCookies();
    expect(activeWorkspace(useWorkspaces.getState()).cookies).toEqual([]);
  });
});
