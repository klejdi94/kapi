import { describe, it, expect } from 'vitest';
import { renderCollectionDocs } from '../docs';
import { newCollection, newRequestNode, withTrailingBlank, kv } from '../factory';

describe('renderCollectionDocs', () => {
  it('includes collection + request description, method/url, and query params', () => {
    const collection = newCollection('Demo API');
    collection.description = 'A tiny demo.';
    const node = newRequestNode('Get user');
    node.request.method = 'GET';
    node.request.url = 'https://api.example.com/users/:id';
    node.request.pathVars = withTrailingBlank([kv({ key: 'id', value: '1' })]);
    node.request.params = withTrailingBlank([kv({ key: 'verbose', value: 'true' })]);
    (node as any).description = 'Fetches one user by id.';
    collection.items = [node];

    const text = renderCollectionDocs(collection);
    expect(text).toContain('# Demo API');
    expect(text).toContain('A tiny demo.');
    expect(text).toContain('Fetches one user by id.');
    expect(text).toContain('GET https://api.example.com/users/:id');
    expect(text).toContain('`verbose`: true');
  });

  it('renders folders as headings and nests their requests underneath', () => {
    const collection = newCollection('Demo');
    const folder = { id: 'f1', type: 'folder' as const, name: 'Users', expanded: true, auth: { type: 'none' } as any, headers: [], items: [newRequestNode('List')] };
    collection.items = [folder];
    const text = renderCollectionDocs(collection);
    expect(text).toContain('Users');
    expect(text).toContain('List');
  });
});
