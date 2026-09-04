import { useMemo } from 'react';
import { EmptyState } from '@/components/ui/primitives';

interface DiffLine {
  kind: 'add' | 'remove' | 'context' | 'meta';
  text: string;
}

interface DiffFile {
  header: string;
  lines: DiffLine[];
}

function parseDiff(text: string): DiffFile[] {
  if (!text.trim()) return [];
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const rawLine of text.split('\n')) {
    if (rawLine.startsWith('diff --git')) {
      current = { header: rawLine.replace(/^diff --git a\/(.*) b\/.*/, '$1'), lines: [] };
      files.push(current);
      continue;
    }
    if (!current) {
      current = { header: 'changes', lines: [] };
      files.push(current);
    }
    if (rawLine.startsWith('+++') || rawLine.startsWith('---') || rawLine.startsWith('index ')) continue;
    if (rawLine.startsWith('@@')) {
      current.lines.push({ kind: 'meta', text: rawLine });
    } else if (rawLine.startsWith('+')) {
      current.lines.push({ kind: 'add', text: rawLine.slice(1) });
    } else if (rawLine.startsWith('-')) {
      current.lines.push({ kind: 'remove', text: rawLine.slice(1) });
    } else {
      current.lines.push({ kind: 'context', text: rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine });
    }
  }
  return files.filter((f) => f.lines.length > 0);
}

const LINE_STYLE: Record<DiffLine['kind'], string> = {
  add: 'bg-ok/10 text-ok',
  remove: 'bg-danger/10 text-danger',
  context: 'text-dim',
  meta: 'text-info bg-info/10',
};

const LINE_PREFIX: Record<DiffLine['kind'], string> = { add: '+', remove: '-', context: ' ', meta: ' ' };

export function DiffView({ diffText }: { diffText: string }) {
  const files = useMemo(() => parseDiff(diffText), [diffText]);

  if (!files.length) {
    return <EmptyState title="No changes" detail="The working tree matches the last commit." />;
  }

  return (
    <div className="flex flex-col gap-4 overflow-auto p-3">
      {files.map((file, i) => (
        <div key={i} className="overflow-hidden rounded-md border border-line">
          <div className="border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[11.5px] text-dim">{file.header}</div>
          <div className="overflow-x-auto bg-surface font-mono text-[12px] leading-relaxed">
            {file.lines.map((line, j) => (
              <div key={j} className={`flex whitespace-pre px-2 ${LINE_STYLE[line.kind]}`}>
                <span className="w-3 shrink-0 select-none opacity-60">{LINE_PREFIX[line.kind]}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
