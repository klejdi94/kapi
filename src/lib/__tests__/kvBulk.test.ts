import { describe, it, expect } from 'vitest';
import { kvRowsToBulkText, bulkTextToKvRows } from '../kvBulk';
import { kv } from '../factory';

describe('kvRowsToBulkText', () => {
  it('renders one key: value per enabled row', () => {
    const rows = [kv({ key: 'Accept', value: 'application/json' }), kv({ key: 'X-Debug', value: '1', enabled: false })];
    expect(kvRowsToBulkText(rows)).toBe('Accept: application/json\n// X-Debug: 1');
  });

  it('skips file rows and blank rows', () => {
    const rows = [kv({ key: '', value: '' }), kv({ key: 'f', value: '', kind: 'file', fileName: 'a.txt' })];
    expect(kvRowsToBulkText(rows)).toBe('');
  });
});

describe('bulkTextToKvRows', () => {
  it('parses key: value lines and disables // -prefixed rows', () => {
    const rows = bulkTextToKvRows('Accept: application/json\n// X-Debug: 1', []);
    expect(rows).toEqual([
      expect.objectContaining({ key: 'Accept', value: 'application/json', enabled: true }),
      expect.objectContaining({ key: 'X-Debug', value: '1', enabled: false }),
    ]);
  });

  it('splits only on the first colon so header values keeping URLs survive', () => {
    const rows = bulkTextToKvRows('Location: https://example.com/a:b', []);
    expect(rows[0]).toMatchObject({ key: 'Location', value: 'https://example.com/a:b' });
  });

  it('reuses an existing row by key so its id/description survive round-tripping', () => {
    const existing = [kv({ key: 'Accept', value: 'text/plain', description: 'keep me' })];
    const [row] = bulkTextToKvRows('Accept: application/json', existing);
    expect(row.id).toBe(existing[0].id);
    expect(row.description).toBe('keep me');
    expect(row.value).toBe('application/json');
  });

  it('ignores blank lines and lines with no key', () => {
    expect(bulkTextToKvRows('\n: novalue\n  \n', [])).toEqual([]);
  });
});
