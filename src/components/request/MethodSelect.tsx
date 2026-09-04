import { useEffect, useRef, useState } from 'react';
import { HTTP_METHODS, type HttpMethod } from '@/types';
import { methodVar } from '@/lib/methodColor';

export function MethodSelect({ value, onChange }: { value: HttpMethod; onChange: (method: HttpMethod) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-[102px] items-center justify-center rounded-l-md border border-r-0 border-line bg-surface text-[13px] font-bold transition-colors hover:bg-surface-2"
        style={{ color: methodVar(value) }}
      >
        {value}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-40 overflow-hidden rounded-lg border border-line bg-surface-2 py-1 shadow-2xl" style={{ boxShadow: 'var(--shadow)' }}>
          {HTTP_METHODS.map((m) => (
            <button
              key={m}
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[12.5px] font-bold hover:bg-surface-3"
              style={{ color: methodVar(m) }}
            >
              {m}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const method = custom.trim().toUpperCase();
              if (method) {
                onChange(method);
                setCustom('');
                setOpen(false);
              }
            }}
            className="px-2 py-1"
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom…"
              className="h-7 w-full rounded border border-line bg-surface px-2 text-[12px] uppercase text-fg placeholder:normal-case placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </form>
        </div>
      )}
    </div>
  );
}
