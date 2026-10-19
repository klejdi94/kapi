import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { contractFromOperation, contractTests, derefSchema } from '../contract';
import { importOpenApi } from '../importers/openapi';
import { headlessTargetsFor, runHeadless, type HeadlessResult } from '@/cli/headlessRunner';
import type { RequestNode, ResponseContract } from '@/types';

const spec31 = {
  openapi: '3.1.0',
  info: { title: 'Pets' },
  servers: [{ url: 'http://127.0.0.1:0' }],
  paths: {
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        responses: {
          '200': { description: 'A pet', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          '404': { description: 'Not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: { id: { type: 'integer' }, name: { type: 'string' }, tag: { type: ['string', 'null'] }, born: { type: 'string', format: 'date' }, owner: { $ref: '#/components/schemas/Person' } },
      },
      Person: { type: 'object', properties: { name: { type: 'string' }, pets: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } },
    },
  },
};

const json = (body: unknown, status = 200) => ({ status, headers: [['Content-Type', 'application/json']] as [string, string][], text: JSON.stringify(body) });

function contract(): ResponseContract {
  return contractFromOperation(spec31.paths['/pets/{id}'].get, spec31)!;
}

describe('contract extraction', () => {
  it('keeps documented statuses and inlines $refs, cutting cycles', () => {
    const c = contract();
    expect(c.specVersion).toBe('3.1');
    expect(Object.keys(c.responses)).toEqual(['200', '404']);
    const pet = c.responses['200'].schema as { properties: Record<string, { properties?: Record<string, { items?: unknown }> }> };
    expect(pet.properties.name).toEqual({ type: 'string' });
    // Pet → owner (Person) → pets (Pet again) is a cycle; the inner Pet becomes {}.
    expect(pet.properties.owner.properties!.pets.items).toEqual({});
  });

  it('handles Swagger 2 and OpenAPI 3.0 nullable', () => {
    const v2 = contractFromOperation({ responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/A' } } } }, { swagger: '2.0', definitions: { A: { type: 'string' } } } as never);
    expect(v2?.responses['200'].schema).toEqual({ type: 'string' });
    const v30: ResponseContract = { specVersion: '3.0', enabled: true, responses: { '200': { description: '', schema: { type: 'object', properties: { tag: { type: 'string', nullable: true } } } } } };
    expect(contractTests(v30, json({ tag: null })).every((t) => t.passed)).toBe(true);
    expect(contractTests(v30, json({ tag: 3 })).at(-1)?.passed).toBe(false);
  });

  it('derefs nested refs and leaves unknown refs open', () => {
    expect(derefSchema({ a: { $ref: '#/x/y' } }, { x: { y: { type: 'integer' } } })).toEqual({ a: { type: 'integer' } });
    expect(derefSchema({ $ref: 'other.yaml#/Foo' }, {})).toEqual({});
  });
});

describe('contract checks', () => {
  it('passes a response that matches', () => {
    const tests = contractTests(contract(), json({ id: 1, name: 'Rex', tag: null, born: '2020-02-29' }));
    expect(tests.map((t) => [t.name, t.passed])).toEqual([
      ['Contract: status 200 is documented', true],
      ['Contract: body matches the schema', true],
    ]);
  });

  it('reports exactly what is wrong', () => {
    const tests = contractTests(contract(), json({ id: 'one', extra: true, born: 'yesterday' }));
    const body = tests.find((t) => t.name.includes('schema'))!;
    expect(body.passed).toBe(false);
    expect(body.error).toMatch(/must have required property 'name'/);
    expect(body.error).toMatch(/\/id must be integer/);
    expect(body.error).toMatch(/additional properties "extra"/);
    expect(body.error).toMatch(/\/born must match format "date"/);
  });

  it('flags undocumented statuses and non-JSON bodies', () => {
    expect(contractTests(contract(), json({}, 500))[0]).toMatchObject({ passed: false, error: expect.stringContaining('200, 404') });
    expect(contractTests(contract(), { status: 404, headers: [], text: '' })).toEqual([{ name: 'Contract: status 404 is documented', passed: true, error: null }]);
    const html = contractTests(contract(), { status: 200, headers: [['Content-Type', 'text/html']], text: '<h1>' });
    expect(html.at(-1)).toMatchObject({ name: 'Contract: body is JSON', passed: false });
  });

  it('does nothing when switched off', () => {
    expect(contractTests({ ...contract(), enabled: false }, json({}, 500))).toEqual([]);
    expect(contractTests(undefined, json({}))).toEqual([]);
  });
});

describe('import → run', () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/pets/1' ? '{"id":1,"name":"Rex"}' : '{"id":"2"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('checks every imported request against its spec with no tests written', async () => {
    const { collection } = importOpenApi({ ...spec31, servers: [{ url: `http://127.0.0.1:${port}` }] } as never);
    const node = collection.items[0] as RequestNode;
    expect(node.request.contract?.enabled).toBe(true);
    node.request.pathVars = node.request.pathVars.map((v) => ({ ...v, value: '1' }));
    const results: HeadlessResult[] = [];
    await runHeadless({ collection, globals: [], environment: null, targets: headlessTargetsFor(collection, null), iterations: 1, dataRows: [], delayMs: 0, onResult: (r) => results.push(r) });
    expect(results[0].status).toBe('passed');

    node.request.pathVars = node.request.pathVars.map((v) => ({ ...v, value: '2' }));
    results.length = 0;
    await runHeadless({ collection, globals: [], environment: null, targets: headlessTargetsFor(collection, null), iterations: 1, dataRows: [], delayMs: 0, onResult: (r) => results.push(r) });
    expect(results[0].status).toBe('failed');
    expect(results[0].tests.find((t) => !t.passed)?.error).toMatch(/\/id must be integer/);
  });
});
