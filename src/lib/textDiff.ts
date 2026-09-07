export interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
}

/** Guards the O(n·m) LCS table below against pathologically large bodies. */
const MAX_LINES = 4000;

/** A small LCS-based line diff — good enough for eyeballing two responses, not a byte-perfect Myers diff. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  if (oldText === newText) return oldText.split('\n').map((text) => ({ kind: 'context', text }));

  const a = oldText.split('\n');
  const b = newText.split('\n');

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      { kind: 'remove', text: `(before: ${a.length} lines — too large to diff line-by-line)` },
      { kind: 'add', text: `(after: ${b.length} lines — too large to diff line-by-line)` },
    ];
  }

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: 'remove', text: a[i] });
      i++;
    } else {
      lines.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) lines.push({ kind: 'remove', text: a[i++] });
  while (j < m) lines.push({ kind: 'add', text: b[j++] });
  return lines;
}
