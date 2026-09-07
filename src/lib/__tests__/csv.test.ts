import { describe, it, expect } from 'vitest';
import { parseCsv } from '../csv';

describe('parseCsv', () => {
  it('parses headers and rows, including quoted commas', () => {
    const rows = parseCsv('name,city\n"Doe, Jane",Rome\nBob,Milan\n');
    expect(rows).toEqual([
      { name: 'Doe, Jane', city: 'Rome' },
      { name: 'Bob', city: 'Milan' },
    ]);
  });

  it('handles escaped quotes inside a quoted field', () => {
    const rows = parseCsv('name\n"She said ""hi"""\n');
    expect(rows).toEqual([{ name: 'She said "hi"' }]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns no rows for a header-only file', () => {
    expect(parseCsv('a,b\n')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
