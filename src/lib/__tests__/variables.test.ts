import { describe, it, expect } from 'vitest';
import { buildScope, resolve, collectUsages, missingNames, lookup, variableSpans } from '../variables';
import { newWorkspace, newCollection, kv } from '../factory';

describe('buildScope precedence', () => {
  it('environment beats collection beats globals', () => {
    const workspace = newWorkspace('W');
    workspace.globals = [kv({ key: 'x', value: 'global' })];
    const env = { id: 'e1', name: 'Env', variables: [kv({ key: 'x', value: 'env' })] };
    workspace.environments = [env];
    workspace.activeEnvironmentId = 'e1';
    const collection = newCollection('C');
    collection.variables = [kv({ key: 'x', value: 'collection' })];

    const scope = buildScope(workspace, collection);
    expect(lookup(scope, 'x')?.value).toBe('env');
  });

  it('falls back to collection then globals when the environment does not set it', () => {
    const workspace = newWorkspace('W');
    workspace.globals = [kv({ key: 'g', value: 'global' })];
    const collection = newCollection('C');
    collection.variables = [kv({ key: 'c', value: 'collection' })];
    const scope = buildScope(workspace, collection);
    expect(lookup(scope, 'g')?.value).toBe('global');
    expect(lookup(scope, 'c')?.value).toBe('collection');
  });
});

describe('resolve', () => {
  it('substitutes {{name}} from the scope', () => {
    const workspace = newWorkspace('W');
    workspace.globals = [kv({ key: 'host', value: 'api.example.com' })];
    const scope = buildScope(workspace, null);
    expect(resolve('https://{{host}}/v1', scope)).toBe('https://api.example.com/v1');
  });

  it('leaves an unknown variable verbatim', () => {
    const scope = buildScope(newWorkspace('W'), null);
    expect(resolve('{{missing}}', scope)).toBe('{{missing}}');
  });

  it('resolves a dynamic variable', () => {
    const scope = buildScope(newWorkspace('W'), null);
    expect(resolve('{{$timestamp}}', scope)).toMatch(/^\d+$/);
  });

  it('resolves nested variable references up to a bound', () => {
    const workspace = newWorkspace('W');
    workspace.globals = [kv({ key: 'a', value: '{{b}}' }), kv({ key: 'b', value: 'final' })];
    const scope = buildScope(workspace, null);
    expect(resolve('{{a}}', scope)).toBe('final');
  });
});

describe('collectUsages / missingNames / variableSpans', () => {
  it('finds every {{var}} used and flags the unresolved ones', () => {
    const workspace = newWorkspace('W');
    workspace.globals = [kv({ key: 'known', value: '1' })];
    const scope = buildScope(workspace, null);
    const usages = collectUsages(['{{known}}/{{unknown}}'], scope);
    expect(usages.map((u) => u.name)).toEqual(['known', 'unknown']);
    expect(missingNames(usages)).toEqual(['unknown']);
  });

  it('locates the position of each {{...}} run', () => {
    const spans = variableSpans('a {{x}} b {{y}}');
    expect(spans).toEqual([
      { start: 2, end: 7, name: 'x' },
      { start: 10, end: 15, name: 'y' },
    ]);
  });
});
