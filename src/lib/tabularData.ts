import type { KapiResponse } from '@/types';
import { parseCsv } from './csv';

export interface TableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Detects whether a response body is naturally table-shaped — a JSON array
 * of objects, or CSV — so the Table/Chart response views only show up when
 * there's actually something to render, the same "hidden unless relevant"
 * idiom `PreviewView`'s `kind === 'none'` and the Stream tab already use.
 */
export function extractTableData(response: KapiResponse): TableData | null {
  if (response.binary || !response.text.trim()) return null;

  const contentType = response.contentType.split(';')[0].trim().toLowerCase();
  if (contentType === 'text/csv') {
    const rows = parseCsv(response.text);
    if (!rows.length) return null;
    return { columns: columnsOf(rows), rows };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.length) return null;
  if (!parsed.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) return null;

  const rows = parsed as Record<string, unknown>[];
  return { columns: columnsOf(rows), rows };
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/** Columns whose value is a finite number in every row that has that column at all — the candidates worth charting. */
export function numericColumns(table: TableData): string[] {
  return table.columns.filter((col) => {
    let sawValue = false;
    for (const row of table.rows) {
      const value = row[col];
      if (value === undefined) continue;
      sawValue = true;
      const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isFinite(num)) return false;
    }
    return sawValue;
  });
}

export function cellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function cellNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : 0;
}

/** Renders table rows back to CSV text for the "Export CSV" action. */
export function tableToCsv(table: TableData): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [table.columns.map(escape).join(',')];
  for (const row of table.rows) lines.push(table.columns.map((col) => escape(cellText(row[col]))).join(','));
  return lines.join('\n');
}
