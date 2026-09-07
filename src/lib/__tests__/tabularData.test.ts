import { describe, it, expect } from 'vitest';
import { extractTableData, numericColumns, tableToCsv } from '../tabularData';
import type { KapiResponse } from '@/types';

function jsonResponse(text: string): KapiResponse {
  return {
    id: '1', status: 200, statusText: 'OK', headers: [], text, blob: null,
    contentType: 'application/json', size: { headers: 0, body: text.length },
    timings: { ttfb: 0, total: 0 }, finalUrl: '', redirected: false, binary: false,
    receivedAt: 0, sent: { method: 'GET', url: '', headers: [], bodyText: null, bodyKind: 'none' },
  };
}

describe('extractTableData', () => {
  it('detects a JSON array of flat objects, unioning columns across rows', () => {
    const table = extractTableData(jsonResponse(JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b', extra: true }])));
    expect(table?.columns).toEqual(['id', 'name', 'extra']);
    expect(table?.rows).toHaveLength(2);
  });

  it('returns null for a JSON object, an empty array, or a non-object array', () => {
    expect(extractTableData(jsonResponse('{"a":1}'))).toBeNull();
    expect(extractTableData(jsonResponse('[]'))).toBeNull();
    expect(extractTableData(jsonResponse('[1,2,3]'))).toBeNull();
  });

  it('parses text/csv responses', () => {
    const response = { ...jsonResponse('id,name\n1,a\n2,b'), contentType: 'text/csv' };
    const table = extractTableData(response);
    expect(table?.columns).toEqual(['id', 'name']);
    expect(table?.rows[0]).toEqual({ id: '1', name: 'a' });
  });
});

describe('numericColumns', () => {
  it('only reports columns that are numeric everywhere they appear', () => {
    const table = extractTableData(jsonResponse(JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])))!;
    expect(numericColumns(table)).toEqual(['id']);
  });
});

describe('tableToCsv', () => {
  it('round-trips into a CSV-safe string, quoting fields with commas', () => {
    const table = extractTableData(jsonResponse(JSON.stringify([{ id: 1, note: 'a, b' }])))!;
    expect(tableToCsv(table)).toBe('id,note\n1,"a, b"');
  });
});
