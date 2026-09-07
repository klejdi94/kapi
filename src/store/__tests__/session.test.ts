import { describe, it, expect, beforeEach } from 'vitest';
import { useSession } from '../session';
import { newTab } from '../../lib/factory';

describe('tab pinning + close-all/close-others', () => {
  beforeEach(() => {
    useSession.setState({ tabs: [], activeTabId: '' });
  });

  it('closeAllTabs keeps pinned tabs', () => {
    const a = newTab({ name: 'A' });
    const b = newTab({ name: 'B', pinned: true });
    useSession.setState({ tabs: [a, b], activeTabId: a.id });
    useSession.getState().closeAllTabs();
    const tabs = useSession.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(b.id);
  });

  it('closeOtherTabs keeps the target and any pinned tabs', () => {
    const a = newTab({ name: 'A' });
    const b = newTab({ name: 'B', pinned: true });
    const c = newTab({ name: 'C' });
    useSession.setState({ tabs: [a, b, c], activeTabId: c.id });
    useSession.getState().closeOtherTabs(c.id);
    const ids = useSession.getState().tabs.map((t) => t.id).sort();
    expect(ids).toEqual([b.id, c.id].sort());
  });

  it('togglePinTab flips the pinned flag', () => {
    const a = newTab({ name: 'A' });
    useSession.setState({ tabs: [a], activeTabId: a.id });
    useSession.getState().togglePinTab(a.id);
    expect(useSession.getState().tabs[0].pinned).toBe(true);
    useSession.getState().togglePinTab(a.id);
    expect(useSession.getState().tabs[0].pinned).toBe(false);
  });
});

describe('openCollectionTab / openFolderTab', () => {
  beforeEach(() => {
    useSession.setState({ tabs: [], activeTabId: '' });
  });

  it('reuses an existing collection tab instead of duplicating it', () => {
    const id1 = useSession.getState().openCollectionTab('c1', 'My Collection');
    const id2 = useSession.getState().openCollectionTab('c1', 'My Collection');
    expect(id1).toBe(id2);
    expect(useSession.getState().tabs).toHaveLength(1);
    expect(useSession.getState().tabs[0].kind).toBe('collection');
  });

  it('reuses an existing folder tab by nodeId', () => {
    const id1 = useSession.getState().openFolderTab('c1', 'f1', 'Users');
    const id2 = useSession.getState().openFolderTab('c1', 'f1', 'Users');
    expect(id1).toBe(id2);
    expect(useSession.getState().tabs).toHaveLength(1);
    expect(useSession.getState().tabs[0].kind).toBe('folder');
  });
});
