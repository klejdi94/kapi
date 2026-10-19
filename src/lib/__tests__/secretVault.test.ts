import { describe, expect, it } from 'vitest';
import { decryptVault, encryptVault, extractSecrets, injectSecrets, referencesVault, sameSecrets } from '../secretVault';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

const envelope = (rows: object[]) =>
  JSON.stringify({
    state: {
      workspaces: [
        {
          id: 'w',
          globals: [{ id: 'g1', key: 'token', value: 'tok-123', enabled: true, secret: true }],
          environments: [{ id: 'e', variables: rows }],
          collections: [{ id: 'c', variables: [{ id: 'c1', key: 'base', value: 'https://x', enabled: true }] }],
        },
      ],
      activeWorkspaceId: 'w',
    },
    version: 1,
  });

const rowsOf = (text: string) => {
  const ws = JSON.parse(text).state.workspaces[0];
  return [...ws.globals, ...ws.environments[0].variables, ...ws.collections[0].variables];
};

describe('secret vault', () => {
  it('moves secret values out of the file and back in', () => {
    const original = envelope([{ id: 'e1', key: 'password', value: 'hunter2', enabled: true, secret: true }]);
    const { text, secrets, count } = extractSecrets(original, {});
    expect(count).toBe(2);
    expect(secrets).toEqual({ g1: 'tok-123', e1: 'hunter2' });
    expect(text).not.toContain('tok-123');
    expect(text).not.toContain('hunter2');
    expect(text).toContain('https://x'); // non-secret values stay
    expect(referencesVault(text)).toBe(true);

    const restored = injectSecrets(text, secrets);
    expect(restored.missing).toBe(0);
    expect(rowsOf(restored.text).map((r) => [r.id, r.value, r.secretInVault])).toEqual([
      ['g1', 'tok-123', undefined],
      ['e1', 'hunter2', undefined],
      ['c1', 'https://x', undefined],
    ]);
  });

  it('keeps an unresolved secret marked instead of losing it', () => {
    const file = envelope([{ id: 'e1', key: 'password', value: '', enabled: true, secret: true, secretInVault: true }]);
    const { missing, text } = injectSecrets(file, { g1: 'tok' });
    expect(missing).toBe(1);
    // Saving again with a vault that still has it carries the old value forward.
    const again = extractSecrets(text, { e1: 'hunter2', g1: 'tok' });
    expect(again.secrets.e1).toBe('hunter2');
    // Saving with a vault that doesn't have it keeps the marker.
    const orphan = extractSecrets(text, {});
    expect(rowsOf(orphan.text).find((r) => r.id === 'e1').secretInVault).toBe(true);
  });

  it('lets a value written into the file by another process win', () => {
    const file = envelope([{ id: 'e1', key: 'password', value: 'from-mcp', enabled: true, secret: true, secretInVault: true }]);
    const { text } = injectSecrets(file, { e1: 'old' });
    expect(rowsOf(text).find((r) => r.id === 'e1').value).toBe('from-mcp');
  });

  it('drops the marker when a row stops being secret', () => {
    const file = envelope([{ id: 'e1', key: 'password', value: 'plain', enabled: true, secret: false, secretInVault: true }]);
    const { text, secrets } = extractSecrets(file, {});
    expect(secrets).toEqual({ g1: 'tok-123' });
    expect(rowsOf(text).find((r) => r.id === 'e1')).toMatchObject({ value: 'plain' });
    expect(rowsOf(text).find((r) => r.id === 'e1').secretInVault).toBeUndefined();
  });

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
