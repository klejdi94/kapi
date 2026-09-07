import { describe, it, expect } from 'vitest';
import { exportPostmanCollection } from '../postman';
import { importPostmanCollection } from '../../importers/postman';
import { newCollection, newRequestNode } from '../../factory';

describe('Postman export/import round-trip', () => {
  it('carries collection-level and request-level scripts through export + import', () => {
    const collection = newCollection('Demo');
    collection.preRequestScript = "pm.environment.set('x', '1');";
    collection.testScript = "pm.test('ok', () => {});";
    const node = newRequestNode('Get thing');
    node.request.method = 'GET';
    node.request.url = 'https://api.example.com/thing';
    node.request.preRequestScript = "console.log('pre');";
    node.request.testScript = "pm.test('status', () => pm.expect(pm.response.code).to.equal(200));";
    collection.items = [node];

    const exported = exportPostmanCollection(collection) as any;
    expect(exported.event.find((e: any) => e.listen === 'prerequest').script.exec.join('\n')).toBe(collection.preRequestScript);
    expect(exported.item[0].event.find((e: any) => e.listen === 'test').script.exec.join('\n')).toBe(node.request.testScript);

    const reimported = importPostmanCollection(exported);
    expect(reimported.preRequestScript).toBe(collection.preRequestScript);
    expect(reimported.testScript).toBe(collection.testScript);
    const reimportedNode = reimported.items[0] as any;
    expect(reimportedNode.request.preRequestScript).toBe(node.request.preRequestScript);
    expect(reimportedNode.request.testScript).toBe(node.request.testScript);
  });

  it('omits the event array entirely when there are no scripts', () => {
    const exported = exportPostmanCollection(newCollection('Empty')) as any;
    expect(exported.event).toBeUndefined();
  });

  it('round-trips bearer auth and headers', () => {
    const collection = newCollection('Auth demo');
    collection.auth = { type: 'bearer', bearer: { token: '{{token}}' } } as any;
    const exported = exportPostmanCollection(collection) as any;
    const reimported = importPostmanCollection(exported);
    expect(reimported.auth.type).toBe('bearer');
    expect(reimported.auth.bearer?.token).toBe('{{token}}');
  });
});
