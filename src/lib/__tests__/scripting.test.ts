import { describe, expect, it } from 'vitest';
import { applyScriptRequest, chainScripts, runScript, type ScriptContext } from '../scripting';
import { kv, newRequest } from '../factory';

const base = (over: Partial<ScriptContext> = {}): ScriptContext => ({
  environment: [kv({ key: 'host', value: 'api.test' })],
  globals: [],
  collectionVariables: [],
  request: { method: 'GET', url: 'https://api.test/users', headers: [['Accept', 'application/json']] },
  ...over,
});

const response = (over: Partial<NonNullable<ScriptContext['response']>> = {}): NonNullable<ScriptContext['response']> => ({
  status: 200,
  statusText: 'OK',
  headers: [['Content-Type', 'application/json']],
  text: JSON.stringify({ id: 7, name: 'Ada', tags: ['a', 'b'], nested: { ok: true } }),
  timeMs: 42,
  ...over,
});

describe('sandbox isolation', () => {
  it('cannot reach Node through globals', async () => {
    const result = await runScript(`pm.environment.set('p', typeof process); pm.environment.set('r', typeof require === 'function' ? 'fn' : 'no');`, 'prerequest', base());
    expect(result.error).toBeNull();
    const env = Object.fromEntries(result.environment.map((r) => [r.key, r.value]));
    expect(env.p).toBe('undefined');
  });

  it('cannot climb a prototype chain back into the host realm', async () => {
    const attempts = [
      `pm.constructor.constructor('return process')()`,
      `pm.environment.get.constructor('return process')()`,
      `console.log.constructor('return process')()`,
      `(function(){ return this })().process`,
      `Function('return this')().process`,
    ];
    for (const attempt of attempts) {
      const result = await runScript(`const p = ${attempt}; if (p && p.getBuiltinModule) { pm.environment.set('escaped', p.getBuiltinModule('child_process').execSync('echo pwned').toString()); }`, 'prerequest', base());
      const escaped = result.environment.find((r) => r.key === 'escaped');
      expect(escaped, attempt).toBeUndefined();
    }
  });

  it('stops an infinite loop instead of hanging', async () => {
    const result = await runScript('while (true) {}', 'prerequest', base(), { timeoutMs: 200 });
    expect(result.error).toMatch(/timed out/);
  });

  it('stops an infinite loop inside a promise callback', async () => {
    const result = await runScript('Promise.resolve().then(() => { while (true) {} })', 'prerequest', base(), { timeoutMs: 200 });
    expect(result.error).toMatch(/timed out/);
  });

  it('reports a syntax error without throwing', async () => {
    const result = await runScript('pm.test("x", () => {', 'test', base({ response: response() }));
    expect(result.error).toBeTruthy();
  });

  it('keeps variable values as strings even if a script returns odd objects', async () => {
    const result = await runScript(`pm.environment.set('obj', { a: 1 }); pm.environment.set('n', 5);`, 'prerequest', base());
    const env = Object.fromEntries(result.environment.map((r) => [r.key, r.value]));
    expect(env.obj).toBe('{"a":1}');
    expect(env.n).toBe('5');
  });
});

describe('pm API', () => {
  it('supports chai-style expectations', async () => {
    const script = `
      const body = pm.response.json();
      pm.test('equal', () => pm.expect(body.id).to.equal(7));
      pm.test('type', () => pm.expect(body.name).to.be.a('string'));
      pm.test('array', () => pm.expect(body.tags).to.be.an('array').that.includes('b'));
      pm.test('deep', () => pm.expect(body.nested).to.eql({ ok: true }));
      pm.test('property', () => pm.expect(body).to.have.property('name', 'Ada'));
      pm.test('property chain', () => pm.expect(body).to.have.property('nested').that.has.property('ok'));
      pm.test('length', () => pm.expect(body.tags).to.have.lengthOf(2));
      pm.test('length chain', () => pm.expect(body.tags).to.have.length.above(1));
      pm.test('numbers', () => pm.expect(body.id).to.be.above(5).and.below(10));
      pm.test('not', () => pm.expect(body.id).to.not.equal(8));
      pm.test('ok', () => pm.expect(body.nested.ok).to.be.true);
      pm.test('exist', () => pm.expect(body.missing).to.not.exist);
      pm.test('oneOf', () => pm.expect(body.id).to.be.oneOf([1, 7]));
      pm.test('match', () => pm.expect(body.name).to.match(/^A/));
      pm.test('keys', () => pm.expect(body).to.have.keys('id', 'name'));
      pm.test('fails', () => pm.expect(body.id).to.equal(8));
    `;
    const result = await runScript(script, 'test', base({ response: response() }));
    expect(result.error).toBeNull();
    const failed = result.tests.filter((t) => !t.passed);
    expect(failed.map((t) => t.name)).toEqual(['fails']);
    expect(failed[0].error).toMatch(/expected 7 to equal 8/);
  });

  it('supports pm.response.to assertions', async () => {
    const script = `
      pm.test('status', () => pm.response.to.have.status(200));
      pm.test('ok', () => pm.response.to.be.ok);
      pm.test('header', () => pm.response.to.have.header('content-type'));
      pm.test('json', () => pm.response.to.be.json);
      pm.test('jsonBody', () => pm.response.to.have.jsonBody('nested.ok', true));
      pm.test('not 404', () => pm.response.to.not.have.status(404));
      pm.test('time', () => pm.expect(pm.response.responseTime).to.be.below(100));
      pm.test('wrong', () => pm.response.to.have.status(201));
    `;
    const result = await runScript(script, 'test', base({ response: response() }));
    expect(result.error).toBeNull();
    expect(result.tests.filter((t) => !t.passed).map((t) => t.name)).toEqual(['wrong']);
  });

  it('resolves variables in Postman precedence and exposes iteration data', async () => {
    const script = `
      pm.variables.set('local', 'L');
      pm.environment.set('out', [pm.variables.get('host'), pm.iterationData.get('user'), pm.variables.get('local'), pm.variables.replaceIn('https://{{host}}/{{user}}')].join('|'));
      pm.environment.set('info', pm.info.eventName + ':' + pm.info.iteration + ':' + pm.info.requestName);
    `;
    const result = await runScript(script, 'prerequest', base({ iterationData: { user: 'u1' }, info: { iteration: 2, requestName: 'List' } }));
    const env = Object.fromEntries(result.environment.map((r) => [r.key, r.value]));
    expect(env.out).toBe('api.test|u1|L|https://api.test/u1');
    expect(env.info).toBe('prerequest:2:List');
    // Local variables never leak into a persisted scope.
    expect(result.environment.find((r) => r.key === 'local')).toBeUndefined();
  });

  it('lets a pre-request script edit the outgoing request', async () => {
    const script = `
      pm.request.headers.add({ key: 'X-Signature', value: 'abc' });
      pm.request.headers.upsert({ key: 'accept', value: 'text/plain' });
      pm.request.url = pm.request.url.toString() + '?page=2';
    `;
    const outcome = await chainScripts([script], { environment: [], globals: [], collectionVariables: [] }, { request: base().request }, 'prerequest');
    expect(outcome.requestChanged).toBe(true);
    const request = applyScriptRequest(
      newRequest({ url: 'https://api.test/users', headers: [kv({ key: 'Accept', value: 'application/json' }), kv({ key: 'X-Off', value: '1', enabled: false })] }),
      outcome,
    );
    expect(request.url).toBe('https://api.test/users?page=2');
    expect(request.headers.map((h) => [h.key, h.value, h.enabled])).toEqual([
      ['Accept', 'text/plain', true],
      ['X-Signature', 'abc', true],
      ['X-Off', '1', false],
    ]);
  });

  it('runs pm.sendRequest through the host, callback and await styles', async () => {
    const seen: string[] = [];
    const sendRequest = async (req: { method: string; url: string; headers: [string, string][]; body: string }) => {
      seen.push(`${req.method} ${req.url} ${req.body}`);
      return { status: 200, statusText: 'OK', headers: [['Content-Type', 'application/json']] as [string, string][], text: '{"token":"t-1"}', timeMs: 5 };
    };
    const script = `
      pm.sendRequest({ url: 'https://auth.test/login', method: 'POST', body: { mode: 'raw', raw: '{"u":1}' } }, (err, res) => {
        pm.environment.set('token', res.json().token);
      });
      const again = await pm.sendRequest('https://auth.test/ping');
      pm.environment.set('ping', String(again.code));
    `;
    const result = await runScript(script, 'prerequest', base(), { sendRequest });
    expect(result.error).toBeNull();
    const env = Object.fromEntries(result.environment.map((r) => [r.key, r.value]));
    expect(env.token).toBe('t-1');
    expect(env.ping).toBe('200');
    expect(seen).toEqual(['POST https://auth.test/login {"u":1}', 'GET https://auth.test/ping ']);
  });

  it('reports a failed pm.sendRequest to the callback', async () => {
    const sendRequest = async () => {
      throw new Error('connection refused');
    };
    const result = await runScript(`pm.sendRequest('https://x.test', (err) => pm.environment.set('err', err.message));`, 'prerequest', base(), { sendRequest });
    expect(result.environment.find((r) => r.key === 'err')?.value).toBe('connection refused');
  });

  it('runs legacy postman.* globals and the tests[] object', async () => {
    const script = `
      postman.setEnvironmentVariable('legacy', responseCode.code);
      tests['status is 200'] = responseCode.code === 200;
      tests['has body'] = responseBody.length === 0;
    `;
    const result = await runScript(script, 'test', base({ response: response() }));
    expect(result.environment.find((r) => r.key === 'legacy')?.value).toBe('200');
    expect(result.tests.map((t) => [t.name, t.passed])).toEqual([
      ['status is 200', true],
      ['has body', false],
    ]);
  });

  it('keeps disabled variables instead of dropping them', async () => {
    const result = await runScript(`pm.environment.set('a', '2');`, 'prerequest', base({ environment: [kv({ key: 'off', value: 'x', enabled: false }), kv({ key: 'a', value: '1' })] }));
    expect(result.environment.map((r) => [r.key, r.value, r.enabled])).toEqual([
      ['off', 'x', false],
      ['a', '2', true],
    ]);
  });

  it('waits for async tests', async () => {
    const result = await runScript(`pm.test('later', async () => { await null; pm.expect(1).to.equal(2); });`, 'test', base({ response: response() }));
    expect(result.tests).toEqual([{ name: 'later', passed: false, error: 'AssertionError: expected 1 to equal 2' }]);
  });

  it('provides the libraries Postman scripts require', async () => {
    const script = `
      const _ = require('lodash');
      const CryptoJS = require('crypto-js');
      const moment = require('moment');
      const uuid = require('uuid');
      const xml2js = require('xml2js');
      pm.environment.set('sum', _.sum([1, 2, 3]));
      pm.environment.set('hmac', CryptoJS.HmacSHA256('message', 'secret').toString(CryptoJS.enc.Hex));
      pm.environment.set('b64', CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse('kapi')));
      pm.environment.set('date', moment.utc('2024-01-02T03:04:05Z').format('YYYY/MM/DD'));
      pm.environment.set('uuid', uuid.v4());
      xml2js.parseString('<a><b>1</b></a>', (err, out) => pm.environment.set('xml', JSON.stringify(out)));
    `;
    const result = await runScript(script, 'prerequest', base());
    expect(result.error).toBeNull();
    const env = Object.fromEntries(result.environment.map((r) => [r.key, r.value]));
    expect(env.sum).toBe('6');
    expect(env.hmac).toBe('8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b');
    expect(env.b64).toBe('a2FwaQ==');
    expect(env.date).toBe('2024/01/02');
    expect(env.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(JSON.parse(env.xml)).toEqual({ a: { b: ['1'] } });
  });

  it('supports the legacy _, CryptoJS and xml2Json globals', async () => {
    const script = `
      pm.environment.set('first', _.first([9, 8]));
      pm.environment.set('md5', CryptoJS.MD5('kapi').toString());
      pm.environment.set('xml', xml2Json('<root><id>7</id></root>').root.id);
    `;
    const result = await runScript(script, 'test', base({ response: response() }));
    expect(result.error).toBeNull();
    const env = Object.fromEntries(result.environment.map((r) => [r.key, r.value]));
    expect(env).toMatchObject({ first: '9', md5: 'e88ddd16d38714e30e6d73592bb16622', xml: '7' });
  });

  it('keeps libraries inside the sandbox realm', async () => {
    const script = `
      const _ = require('lodash');
      const P = _.constructor.constructor('return typeof process')();
      pm.environment.set('p', P);
    `;
    const result = await runScript(script, 'prerequest', base());
    expect(result.environment.find((r) => r.key === 'p')?.value).toBe('undefined');
  });

  it('lists what is available when a module is missing', async () => {
    const result = await runScript(`require('left-pad')`, 'prerequest', base());
    expect(result.error).toMatch(/left-pad.*Available: atob, btoa, chai, crypto-js, lodash, moment, uuid, xml2js/);
  });
});
