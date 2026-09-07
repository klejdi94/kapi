import { describe, it, expect } from 'vitest';
import { diffOpenApiSpecs, hasChanges } from '../openapiDiff';

describe('diffOpenApiSpecs', () => {
  it('reports everything as added when there is no previous spec', () => {
    const diff = diffOpenApiSpecs(null, { paths: { '/users': { get: {} }, '/users/{id}': { get: {}, delete: {} } } });
    expect(diff.added).toEqual(['GET /users', 'DELETE /users/{id}', 'GET /users/{id}'].sort());
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(hasChanges(diff)).toBe(true);
  });

  it('finds added, removed and changed operations between two specs', () => {
    const oldDoc = { paths: { '/users': { get: { summary: 'List' } }, '/users/{id}': { delete: {} } } };
    const newDoc = { paths: { '/users': { get: { summary: 'List all' } }, '/orders': { post: {} } } };
    const diff = diffOpenApiSpecs(oldDoc, newDoc);
    expect(diff.added).toEqual(['POST /orders']);
    expect(diff.removed).toEqual(['DELETE /users/{id}']);
    expect(diff.changed).toEqual(['GET /users']);
    expect(diff.unchanged).toBe(0);
  });

  it('reports no changes when nothing in the operations differs', () => {
    const doc = { paths: { '/ping': { get: { summary: 'Health check' } } } };
    const diff = diffOpenApiSpecs(doc, { paths: { '/ping': { get: { summary: 'Health check' } } } });
    expect(hasChanges(diff)).toBe(false);
    expect(diff.unchanged).toBe(1);
  });
});
