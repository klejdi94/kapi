import type { KV } from '@/types';
import { kv } from './factory';

/** One `key: value` per line, matching Postman's bulk-edit convention; a `//` or `#` prefix marks a disabled row. */
export function kvRowsToBulkText(rows: KV[]): string {
  return rows
    .filter((r) => r.kind !== 'file' && (r.key || r.value))
    .map((r) => `${r.enabled ? '' : '// '}${r.key}: ${r.value}`)
    .join('\n');
}

/**
 * Parses bulk text back into rows, reusing an existing row (by key) when one
 * matches so its id/description/secret flag survive the round-trip instead
 * of every edit turning into brand-new rows.
 */
export function bulkTextToKvRows(text: string, existing: KV[]): KV[] {
  const pool = [...existing];
  const takeExisting = (key: string): KV | undefined => {
    const idx = pool.findIndex((r) => r.key === key);
    if (idx === -1) return undefined;
    return pool.splice(idx, 1)[0];
  };

  const rows: KV[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const disabled = line.startsWith('//') || line.startsWith('#');
    const content = disabled ? line.replace(/^\/\/\s?|^#\s?/, '') : line;
    const sepIdx = content.indexOf(':');
    const key = (sepIdx === -1 ? content : content.slice(0, sepIdx)).trim();
    const value = sepIdx === -1 ? '' : content.slice(sepIdx + 1).trim();
    if (!key) continue;
    const prior = takeExisting(key);
    rows.push({ ...(prior ?? kv()), key, value, enabled: !disabled });
  }
  return rows;
}
