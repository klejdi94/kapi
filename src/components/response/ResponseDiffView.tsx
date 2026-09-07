import { useMemo } from 'react';
import clsx from 'clsx';
import type { KapiResponse } from '@/types';
import { diffLines, type DiffLine } from '@/lib/textDiff';
import { beautify, languageFor } from '@/lib/format';

const LINE_STYLE: Record<DiffLine['kind'], string> = {
  add: 'bg-ok/10 text-ok',
  remove: 'bg-danger/10 text-danger',
  context: 'text-dim',
};
const LINE_PREFIX: Record<DiffLine['kind'], string> = { add: '+', remove: '-', context: ' ' };

function headerText(r: KapiResponse): string {
  return [`${r.status} ${r.statusText}`, ...r.headers.map(([k, v]) => `${k}: ${v}`)].join('\n');
}

function bodyText(r: KapiResponse): string {
  if (r.binary) return '(binary body)';
  return beautify(r.text, languageFor(r.contentType, r.text));
}

function DiffBlock({ title, lines }: { title: string; lines: DiffLine[] }) {
  const changed = lines.some((l) => l.kind !== 'context');
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[11.5px] text-dim">
        <span>{title}</span>
        {!changed && <span className="text-faint">no changes</span>}
      </div>
      <div className="overflow-x-auto bg-surface font-mono text-[12px] leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className={clsx('flex whitespace-pre px-2', LINE_STYLE[line.kind])}>
            <span className="w-3 shrink-0 select-none opacity-60">{LINE_PREFIX[line.kind]}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Line diff between two responses — status & headers, then body, each pretty-printed first when it's textual. */
export function ResponseDiffView({ before, after }: { before: KapiResponse; after: KapiResponse }) {
  const headerDiff = useMemo(() => diffLines(headerText(before), headerText(after)), [before, after]);
  const bodyDiff = useMemo(() => diffLines(bodyText(before), bodyText(after)), [before, after]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <DiffBlock title="Status & headers" lines={headerDiff} />
      <DiffBlock title="Body" lines={bodyDiff} />
    </div>
  );
}
