import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorAbove?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', close);
    document.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const clampedX = Math.min(x, window.innerWidth - 200);
  const clampedY = Math.min(y, window.innerHeight - items.length * 30 - 16);

  return createPortal(
    <div
      ref={ref}
      className="animate-in fixed z-[200] min-w-[180px] overflow-hidden rounded-lg border border-line bg-surface-2 py-1"
      style={{ left: clampedX, top: clampedY, boxShadow: 'var(--shadow)' }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorAbove && <div className="my-1 border-t border-line" />}
          <button
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={clsx(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
              'disabled:opacity-40 disabled:pointer-events-none',
              item.danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-surface-3',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
