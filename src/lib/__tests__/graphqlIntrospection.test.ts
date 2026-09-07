import { describe, it, expect } from 'vitest';
import { summarizeIntrospection, buildSkeletonQuery } from '../graphqlIntrospection';

const FAKE_SCHEMA = {
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      types: [
        {
          kind: 'OBJECT', name: 'Query', description: null,
          fields: [
            {
              name: 'user', description: 'Fetch a user by id',
              args: [{ name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID', ofType: null } } }],
              type: { kind: 'OBJECT', name: 'User', ofType: null },
            },
          ],
        },
        {
          kind: 'OBJECT', name: 'Mutation', description: null,
          fields: [
            {
              name: 'createUser', description: null,
              args: [{ name: 'name', type: { kind: 'SCALAR', name: 'String', ofType: null } }],
              type: { kind: 'NON_NULL', name: null, ofType: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'User', ofType: null } } },
            },
          ],
        },
        {
          kind: 'OBJECT', name: 'User', description: null,
          fields: [
            { name: 'id', description: null, args: [], type: { kind: 'SCALAR', name: 'ID', ofType: null } },
            { name: 'name', description: null, args: [], type: { kind: 'SCALAR', name: 'String', ofType: null } },
          ],
        },
      ],
    },
  },
};

describe('summarizeIntrospection', () => {
  it('extracts queries and mutations with rendered arg/return types', () => {
    const summary = summarizeIntrospection(FAKE_SCHEMA)!;
    expect(summary.queries).toHaveLength(1);
    expect(summary.queries[0].name).toBe('user');
    expect(summary.queries[0].args).toEqual([{ name: 'id', type: 'ID!' }]);
    expect(summary.queries[0].returnType).toBe('User');
    expect(summary.mutations[0].returnType).toBe('[User]!');
  });

  it('returns null for a non-schema payload', () => {
    expect(summarizeIntrospection({ data: {} })).toBeNull();
  });
});

describe('buildSkeletonQuery', () => {
  it('builds a query with args and a nested selection from the return type', () => {
    const summary = summarizeIntrospection(FAKE_SCHEMA)!;
    const skeleton = buildSkeletonQuery(summary.queries[0], 'query', summary);
    expect(skeleton).toContain('query {');
    expect(skeleton).toContain('user(id: "")');
    expect(skeleton).toContain('id');
    expect(skeleton).toContain('name');
  });

  it('builds a mutation skeleton', () => {
    const summary = summarizeIntrospection(FAKE_SCHEMA)!;
    const skeleton = buildSkeletonQuery(summary.mutations[0], 'mutation', summary);
    expect(skeleton.startsWith('mutation {')).toBe(true);
    expect(skeleton).toContain('createUser(name: "")');
  });
});
