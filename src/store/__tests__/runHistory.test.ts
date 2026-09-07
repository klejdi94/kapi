import { describe, it, expect, beforeEach } from 'vitest';
import { useRunHistory } from '../runHistory';
import type { RunHistoryEntry } from '@/types';

function entry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
  return {
    id: Math.random().toString(36),
    collectionId: 'c1',
    collectionName: 'Demo',
    scopeName: null,
    at: Date.now(),
    iterations: 1,
    durationMs: 100,
    passed: 1,
    failed: 0,
    errored: 0,
    results: [],
    ...overrides,
  };
}

describe('useRunHistory', () => {
  beforeEach(() => {
    useRunHistory.setState({ entries: [] });
  });

  it('adds entries most-recent first', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b' });
    useRunHistory.getState().add(a);
    useRunHistory.getState().add(b);
    expect(useRunHistory.getState().entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('removes one entry by id', () => {
    useRunHistory.getState().add(entry({ id: 'a' }));
    useRunHistory.getState().add(entry({ id: 'b' }));
    useRunHistory.getState().remove('a');
    expect(useRunHistory.getState().entries.map((e) => e.id)).toEqual(['b']);
  });

  it('clearFor only removes entries for that collection', () => {
    useRunHistory.getState().add(entry({ id: 'a', collectionId: 'c1' }));
    useRunHistory.getState().add(entry({ id: 'b', collectionId: 'c2' }));
    useRunHistory.getState().clearFor('c1');
    expect(useRunHistory.getState().entries.map((e) => e.id)).toEqual(['b']);
  });

  it('caps stored entries at 200', () => {
    for (let i = 0; i < 210; i++) useRunHistory.getState().add(entry({ id: String(i) }));
    expect(useRunHistory.getState().entries).toHaveLength(200);
  });
});
