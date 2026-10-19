import { describe, expect, it } from 'vitest';
import { decryptVault, encryptVault, extractSecrets, injectSecrets, mergeVault, referencesVault, sameSecrets } from '../secretVault';
import { keepLocalSecrets, redactCollections } from '../secretFields';
import { emptyAuth, kv, newCollection, newFolder, newRequestNode } from '../factory';
import type { Collection } from '@/types';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const WS = 'kapi.workspaces';

function bearer(token: string) {
  return { ...emptyAuth('bearer'), bearer: { token } };
}

function sampleCollection(): Collection {
  const c = newCollection('api');
  c.id = 'c';
  c.auth = { ...emptyAuth('basic'), basic: { username: 'ada', password: 'collection-pass' } };
  c.variables = [kv({ id: 'c1', key: 'base', value: 'https://x' }), kv({ id: 'c2', key: 'apiKey', value: 'k-123', secret: true })];
  const folder = newFolder('admin');
  folder.id = 'f';
  folder.auth = bearer('{{adminToken}}');
  const req = newRequestNode('me', { url: '{{base}}/me', auth: bearer('literal-token') });
  req.id = 'r';
  folder.items = [req];
  c.items = [folder];
  return c;
}

const envelope = (rows: object[], collections: Collection[] = [sampleCollection()]) =>
  JSON.stringify({
    state: {
      workspaces: [{ id: 'w', globals: [{ id: 'g1', key: 'token', value: 'tok-123', enabled: true, secret: true }], environments: [{ id: 'e', variables: rows }], collections }],
      activeWorkspaceId: 'w',
    },
    version: 1,
  });

const parse = (text: string) => JSON.parse(text).state.workspaces[0];

describe('secret vault: variables', () => {
  it('moves secret values out of the file and back in', () => {
    const original = envelope([{ id: 'e1', key: 'password', value: 'hunter2', enabled: true, secret: true }]);
    const { text, secrets } = extractSecrets(original, {}, WS);
    expect(secrets).toMatchObject({ [`${WS}/var/g1`]: 'tok-123', [`${WS}/var/e1`]: 'hunter2', [`${WS}/var/c2`]: 'k-123' });
    for (const secret of ['tok-123', 'hunter2', 'k-123']) expect(text).not.toContain(secret);
    expect(text).toContain('https://x');
    expect(referencesVault(text)).toBe(true);

    const restored = injectSecrets(text, secrets, WS);
    expect(restored.missing).toBe(0);
    expect(JSON.parse(restored.text)).toEqual(JSON.parse(original));
  });

  it('keeps an unresolved secret marked instead of losing it', () => {
    const file = envelope([{ id: 'e1', key: 'password', value: '', enabled: true, secret: true, secretInVault: true }], []);
    const { missing, text } = injectSecrets(file, {}, WS);
    expect(missing).toBe(1);
    const again = extractSecrets(text, { [`${WS}/var/e1`]: 'hunter2' }, WS);
    expect(again.secrets[`${WS}/var/e1`]).toBe('hunter2');
    const orphan = extractSecrets(text, {}, WS);
    expect(parse(orphan.text).environments[0].variables[0].secretInVault).toBe(true);
  });

  it('lets a value written into the file by another process win', () => {
    const file = envelope([{ id: 'e1', key: 'password', value: 'from-mcp', enabled: true, secret: true, secretInVault: true }], []);
    const { text } = injectSecrets(file, { [`${WS}/var/e1`]: 'old' }, WS);
    expect(parse(text).environments[0].variables[0].value).toBe('from-mcp');
  });

  it('drops the marker when a row stops being secret', () => {
    const file = envelope([{ id: 'e1', key: 'password', value: 'plain', enabled: true, secret: false, secretInVault: true }], []);
    const { text, secrets } = extractSecrets(file, {}, WS);
    expect(Object.keys(secrets)).toEqual([`${WS}/var/g1`]);
    expect(parse(text).environments[0].variables[0]).toMatchObject({ value: 'plain' });
    expect(parse(text).environments[0].variables[0].secretInVault).toBeUndefined();
  });
});

describe('secret vault: auth credentials', () => {
  it('vaults literal credentials at every level but leaves {{references}} alone', () => {
    const { text, secrets } = extractSecrets(envelope([]), {}, WS);
    expect(secrets[`${WS}/auth/c/basic.password`]).toBe('collection-pass');
    expect(secrets[`${WS}/auth/r/bearer.token`]).toBe('literal-token');
    expect(Object.keys(secrets).some((k) => k.includes('/auth/f/'))).toBe(false);
    const collection = parse(text).collections[0];
    expect(collection.auth.basic).toEqual({ username: 'ada', password: '' });
    expect(collection.auth.vaulted).toEqual(['basic.password']);
    expect(collection.items[0].auth.bearer.token).toBe('{{adminToken}}');
    expect(collection.items[0].items[0].request.auth.bearer.token).toBe('');

    const restored = injectSecrets(text, secrets, WS);
    const back = parse(restored.text).collections[0];
    expect(back.auth.basic.password).toBe('collection-pass');
    expect(back.auth.vaulted).toBeUndefined();
    expect(back.items[0].items[0].request.auth.bearer.token).toBe('literal-token');
  });

  it('covers open tabs and history entries', () => {
    const session = JSON.stringify({ state: { tabs: [{ id: 't1', request: { auth: bearer('tab-token') } }] }, version: 1 });
    const s = extractSecrets(session, {}, 'kapi.session');
    expect(s.secrets).toEqual({ 'kapi.session/auth/t1/bearer.token': 'tab-token' });
    expect(s.text).not.toContain('tab-token');

    const history = JSON.stringify({ state: { entries: [{ id: 'h1', request: { auth: { ...emptyAuth('awsv4'), awsv4: { accessKey: 'AKID', secretKey: 'shh', sessionToken: '', region: 'eu-west-1', service: 's3' } } } }] }, version: 1 });
    const h = extractSecrets(history, {}, 'kapi.history');
    expect(h.secrets).toEqual({ 'kapi.history/auth/h1/awsv4.secretKey': 'shh' });
    expect(JSON.parse(h.text).state.entries[0].request.auth.awsv4.accessKey).toBe('AKID');
  });

  it('merges one store into the vault without touching the others', () => {
    const vault = { 'kapi.session/auth/t/bearer.token': 'a', 'kapi.workspaces/var/x': 'old', 'kapi.workspaces/var/gone': 'z' };
    expect(mergeVault(vault, WS, { 'kapi.workspaces/var/x': 'new' })).toEqual({ 'kapi.session/auth/t/bearer.token': 'a', 'kapi.workspaces/var/x': 'new' });
  });
});

describe('git snapshots', () => {
  it('blank secrets on the way out and keep local ones on the way in', () => {
    const local = [sampleCollection()];
    const redacted = redactCollections(local);
    const text = JSON.stringify(redacted);
    for (const secret of ['collection-pass', 'literal-token', 'k-123']) expect(text).not.toContain(secret);
    expect(text).toContain('{{adminToken}}');
    expect(local[0].auth.basic?.password).toBe('collection-pass'); // the original is untouched

    redacted[0].name = 'renamed upstream';
    const merged = keepLocalSecrets(redacted, local);
    expect(merged[0].name).toBe('renamed upstream');
    expect(merged[0].auth.basic?.password).toBe('collection-pass');
    expect(merged[0].variables.find((v) => v.key === 'apiKey')?.value).toBe('k-123');
  });
});

describe('vault encryption', () => {
  it('round-trips through AES-GCM and refuses the wrong key', async () => {
    const vault = await encryptVault({ e1: 'hunter2', g1: 'tök 🔑' }, KEY);
    expect(JSON.stringify(vault)).not.toContain('hunter2');
    expect(await decryptVault(JSON.stringify(vault), KEY)).toEqual({ e1: 'hunter2', g1: 'tök 🔑' });
    await expect(decryptVault(JSON.stringify(vault), OTHER_KEY)).rejects.toThrow();
  });

  it('uses a fresh IV for every write', async () => {
    const a = await encryptVault({ x: '1' }, KEY);
    const b = await encryptVault({ x: '1' }, KEY);
    expect(a.iv).not.toBe(b.iv);
  });

  it('compares secret maps by content', () => {
    expect(sameSecrets({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameSecrets({ a: '1' }, { a: '2' })).toBe(false);
    expect(sameSecrets({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });
});
