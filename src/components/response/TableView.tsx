import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import clsx from 'clsx';
import type { TableData } from '@/lib/tabularData';
import { cellText, cellNumber, tableToCsv } from '@/lib/tabularData';
import { Button } from '@/components/ui/primitives';
import { saveFile } from '@/lib/saveFile';
import { toast } from '@/lib/toast';

/** A real `<table>`, styled like `Views.tsx`'s `CookiesView` — the response body rendered as rows instead of raw JSON, for the shape of data that's actually a list of things. */
export function TableView({ table }: { table: TableData }) {
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const { column, dir } = sort;
    const sorted = [...table.rows].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      const bothNumeric = isNumericish(av) && isNumericish(bv);
      const cmp = bothNumeric ? cellNumber(av) - cellNumber(bv) : cellText(av).localeCompare(cellText(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [table.rows, sort]);

  const toggleSort = (column: string) => {
    setSort((prev) => (prev?.column === column ? (prev.dir === 'asc' ? { column, dir: 'desc' } : null) : { column, dir: 'asc' }));
  };

  const exportCsv = async () => {
    const path = await saveFile('response.csv', tableToCsv(table), 'text/csv');
    if (path === null) return;
    toast.success('Exported CSV', path || 'response.csv');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] text-faint">
          {table.rows.length} row{table.rows.length === 1 ? '' : 's'} · {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
        </span>
        <Button size="sm" onClick={exportCsv}>
          <Download size={11} /> Export CSV
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full min-w-max border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-faint">
              {table.columns.map((col) => (
                <th key={col} className="sticky top-0 border-b border-line bg-surface py-1.5 pr-4 font-medium">
                  <button onClick={() => toggleSort(col)} className="flex items-center gap-1 hover:text-fg">
                    {col}
                    {sort?.column === col && (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={clsx(i % 2 === 1 && 'bg-surface-2/40')}>
                {table.columns.map((col) => (
                  <td key={col} className="max-w-[280px] truncate border-b border-line py-1.5 pr-4 font-mono text-fg" title={cellText(row[col])}>
                    {cellText(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function isNumericish(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return value.trim() !== '' && Number.isFinite(Number(value));
  return false;
}
