import { useMemo, useState } from 'react';
import type { TableData } from '@/lib/tabularData';
import { cellNumber, cellText, numericColumns } from '@/lib/tabularData';
import { Select, Segmented, EmptyState } from '@/components/ui/primitives';

const WIDTH = 640;
const HEIGHT = 280;
const PADDING = { top: 16, right: 16, bottom: 36, left: 48 };
const MAX_POINTS = 200;

/** A hand-rolled SVG bar/line chart over the response's table data — no charting library, same "just SVG, no dependency" taste as the rest of the app (`JsonTree.tsx`, `TimingsView`). */
export function ChartView({ table }: { table: TableData }) {
  const numeric = useMemo(() => numericColumns(table), [table]);
  const [yColumn, setYColumn] = useState(numeric[0] ?? '');
  const [xColumn, setXColumn] = useState(table.columns.find((c) => c !== numeric[0]) ?? table.columns[0] ?? '');
  const [kind, setKind] = useState<'bar' | 'line'>('bar');

  if (!numeric.length) {
    return <EmptyState title="Nothing numeric to chart" detail="This table has no column that's a number in every row." />;
  }

  const points = table.rows.slice(0, MAX_POINTS).map((row) => ({ x: cellText(row[xColumn]), y: cellNumber(row[yColumn]) }));
  const truncated = table.rows.length > MAX_POINTS;

  const maxY = Math.max(...points.map((p) => p.y), 0);
  const minY = Math.min(...points.map((p) => p.y), 0);
  const spanY = maxY - minY || 1;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xFor = (i: number) => PADDING.left + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : plotWidth / 2);
  const yFor = (v: number) => PADDING.top + plotHeight - ((v - minY) / spanY) * plotHeight;
  const zeroY = yFor(0);

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minY + (spanY * i) / ticks);

  const barWidth = points.length ? Math.max(2, plotWidth / points.length - 4) : 0;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.y)}`).join(' ');

  // Label every point when there are few, otherwise thin them out so text never overlaps.
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-1.5">
        <label className="flex items-center gap-1.5 text-[11px] text-faint">
          X
          <Select value={xColumn} onChange={(e) => setXColumn(e.target.value)} className="h-6.5 text-[11.5px]">
            {table.columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-faint">
          Y
          <Select value={yColumn} onChange={(e) => setYColumn(e.target.value)} className="h-6.5 text-[11.5px]">
            {numeric.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'bar', label: 'Bar' }, { value: 'line', label: 'Line' }] as const} />
        {truncated && <span className="ml-auto text-[10.5px] text-faint">Showing the first {MAX_POINTS} rows</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-3xl" role="img" aria-label={`${kind} chart of ${yColumn} by ${xColumn}`}>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={yFor(t)} y2={yFor(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PADDING.left - 6} y={yFor(t)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--text-faint)">
                {formatTick(t)}
              </text>
            </g>
          ))}
          <line x1={PADDING.left} x2={PADDING.left} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="var(--border-strong)" strokeWidth={1} />
          <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth={1} />

          {kind === 'bar'
            ? points.map((p, i) => {
                const x = xFor(i) - barWidth / 2;
                const y = Math.min(yFor(p.y), zeroY);
                const h = Math.abs(yFor(p.y) - zeroY);
                return <rect key={i} x={x} y={y} width={barWidth} height={Math.max(h, 0.5)} fill="var(--accent)" rx={1} />;
              })
            : (
                <>
                  <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />
                  {points.map((p, i) => (
                    <circle key={i} cx={xFor(i)} cy={yFor(p.y)} r={2.5} fill="var(--accent)" />
                  ))}
                </>
              )}

          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={xFor(i)} y={HEIGHT - PADDING.bottom + 14} textAnchor="middle" fontSize={9} fill="var(--text-faint)">
                {truncateLabel(p.x)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </div>
  );
}

function formatTick(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function truncateLabel(label: string): string {
  return label.length > 10 ? `${label.slice(0, 9)}…` : label;
}
