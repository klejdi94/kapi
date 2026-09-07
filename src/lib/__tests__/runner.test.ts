import { describe, it, expect } from 'vitest';
import { targetsFor } from '../runner';
import type { Collection } from '@/types';

const collection: Collection = {
  id: 'c1', name: 'Demo', description: '', expanded: true,
  auth: { type: 'none' } as never, headers: [], variables: [],
  items: [
    { id: 'r1', type: 'request', name: 'Login', request: {} as never },
    {
      id: 'f1', type: 'folder', name: 'Users', expanded: true,
      auth: { type: 'inherit' } as never, headers: [],
      items: [{ id: 'r2', type: 'request', name: 'Get user', request: {} as never }],
    },
  ],
};

describe('targetsFor', () => {
  it('flattens the whole collection when no scope is given', () => {
    const targets = targetsFor(collection, null);
    expect(targets.map((t) => t.node.name)).toEqual(['Login', 'Get user']);
    expect(targets[1].path).toEqual(['Users']);
  });

  it('scopes to a single folder', () => {
    expect(targetsFor(collection, 'f1').map((t) => t.node.name)).toEqual(['Get user']);
  });

  it('scopes to a single request', () => {
    expect(targetsFor(collection, 'r1').map((t) => t.node.name)).toEqual(['Login']);
  });

  it('returns nothing for an id that does not exist', () => {
    expect(targetsFor(collection, 'missing')).toEqual([]);
  });
});
