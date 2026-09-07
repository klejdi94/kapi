import { describe, it, expect } from 'vitest';
import { exportOpenApi } from '../openapi';
import { newCollection, newRequestNode, withTrailingBlank, kv } from '../../factory';

describe('exportOpenApi', () => {
  it('converts :id path vars to {id} and picks up the server from the majority host', () => {
    const collection = newCollection('Demo API');
    const node = newRequestNode('Get user');
    node.request.method = 'GET';
    node.request.url = 'https://api.example.com/users/:id';
    node.request.pathVars = withTrailingBlank([kv({ key: 'id', value: '1' })]);
    node.request.params = withTrailingBlank([kv({ key: 'verbose', value: 'true' })]);
    collection.items = [node];

    const spec = exportOpenApi(collection) as any;
    expect(spec.servers[0].url).toBe('https://api.example.com');
    expect(spec.paths['/users/{id}'].get.summary).toBe('Get user');
    expect(spec.paths['/users/{id}'].get.parameters.some((p: any) => p.name === 'id' && p.in === 'path')).toBe(true);
    expect(spec.paths['/users/{id}'].get.parameters.some((p: any) => p.name === 'verbose' && p.in === 'query')).toBe(true);
  });

  it('groups requests by folder into tags', () => {
    const collection = newCollection('Demo');
    const req = newRequestNode('List users');
    req.request.method = 'GET';
    req.request.url = 'https://api.example.com/users';
    const folder = { id: 'f1', type: 'folder' as const, name: 'Users', expanded: true, auth: { type: 'none' } as any, headers: [], items: [req] };
    collection.items = [folder];
    const spec = exportOpenApi(collection) as any;
    expect(spec.paths['/users'].get.tags).toEqual(['Users']);
  });

  it('includes a JSON request body as the example', () => {
    const collection = newCollection('Demo');
    const node = newRequestNode('Create thing');
    node.request.method = 'POST';
    node.request.url = 'https://api.example.com/things';
    node.request.body = { ...node.request.body, mode: 'json', text: { ...node.request.body.text, json: '{"name":"x"}' } };
    collection.items = [node];
    const spec = exportOpenApi(collection) as any;
    const body = spec.paths['/things'].post.requestBody;
    expect(body.content['application/json'].example).toEqual({ name: 'x' });
  });
});
