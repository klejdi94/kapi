import { useCallback, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

/** Percent-of-container resize, used for the request/response split pane. */
export function Splitter({
  direction,
  min = 20,
  max = 80,
  onResize,
}: {
  direction: 'horizontal' | 'vertical';
  min?: number;
  max?: number;
  onResize: (percent: number) => void;
}) {
  const dragging = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      const container = (e.currentTarget as HTMLElement).parentElement!;
      const rect = container.getBoundingClientRect();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        if (!dragging.current) return;
        const percent =
          direction === 'horizontal'
            ? ((ev.clientX - rect.left) / rect.width) * 100
            : ((ev.clientY - rect.top) / rect.height) * 100;
        onResize(Math.min(max, Math.max(min, percent)));
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [direction, min, max, onResize],
  );

  return (
    <div onPointerDown={onPointerDown} className={clsx('group relative shrink-0 bg-line', direction === 'horizontal' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize')}>
      <div className={clsx('absolute bg-transparent group-hover:bg-accent/30', direction === 'horizontal' ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0')} />
    </div>
  );
}

/** Absolute-pixel resize, used for the sidebar's own width. */
export function PixelSplitter({ min = 200, max = 480, onResize }: { min?: number; max?: number; onResize: (px: number) => void }) {
  const dragging = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      const container = (e.currentTarget as HTMLElement).parentElement!;
      const rect = container.getBoundingClientRect();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        if (!dragging.current) return;
        onResize(Math.min(max, Math.max(min, ev.clientX - rect.left)));
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [min, max, onResize],
  );

  return (
    <div onPointerDown={onPointerDown} className="group relative w-px shrink-0 cursor-col-resize bg-line">
      <div className="absolute -inset-x-1 inset-y-0 bg-transparent group-hover:bg-accent/30" />
    </div>
  );
}

export function SplitPane({
  direction,
  ratio,
  onRatio,
  first,
  second,
}: {
  direction: 'horizontal' | 'vertical';
  ratio: number;
  onRatio: (v: number) => void;
  first: ReactNode;
  second: ReactNode;
}) {
  return (
    <div className={clsx('flex min-h-0 flex-1', direction === 'horizontal' ? 'flex-row' : 'flex-col')}>
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flexBasis: `${ratio}%` }}>
        {first}
      </div>
      <Splitter direction={direction} onResize={onRatio} />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{second}</div>
    </div>
  );
}
