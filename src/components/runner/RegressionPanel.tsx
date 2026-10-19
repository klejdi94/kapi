import { TrendingDown, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import type { RunComparison } from '@/lib/regression';

/** "Compared with <baseline>": what got slower or more error-prone, and what got better. */
export function RegressionPanel({ comparison, baselineLabel }: { comparison: RunComparison; baselineLabel: string }) {
  const notable = comparison.changes.filter((c) => c.kind === 'regressed' || c.kind === 'improved' || c.kind === 'new' || c.kind === 'removed');
  const tooFew = comparison.changes.filter((c) => c.kind === 'too-few-samples').length;
  return (
    <div className={clsx('rounded-md border px-3 py-2 text-[11.5px]', comparison.regressed ? 'border-danger/40 bg-danger/5' : 'border-line bg-surface-2/50')}>
      <div className="flex items-center gap-1.5 font-medium text-dim">
        {comparison.regressed ? <TrendingDown size={13} className="text-danger" /> : <TrendingUp size={13} className="text-ok" />}
        {comparison.regressed
          ? `${comparison.regressed} request${comparison.regressed === 1 ? '' : 's'} regressed compared with ${baselineLabel}`
          : `No performance regressions compared with ${baselineLabel}`}
      </div>
      {notable.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {notable.map((c) => (
            <li key={c.key} className="flex gap-2">
              <span
                className={clsx(
                  'w-16 shrink-0 text-[10px] font-semibold uppercase',
                  c.kind === 'regressed' ? 'text-danger' : c.kind === 'improved' ? 'text-ok' : 'text-faint',
                )}
              >
                {c.kind}
              </span>
              <span className="min-w-0 truncate text-fg" title={c.label}>{c.label}</span>
              <span className="ml-auto shrink-0 text-faint">{c.reasons.join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      {tooFew > 0 && (
        <p className="mt-1 text-faint">
          Latency of {tooFew} request{tooFew === 1 ? '' : 's'} wasn't judged — under 3 samples on a side. Run more iterations for a reliable comparison.
        </p>
      )}
    </div>
  );
}
