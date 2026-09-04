import { useEffect, useState } from 'react';
import { Spinner } from './primitives';

/**
 * Shelling out to the claude CLI regularly takes 10-30s. Without a running
 * clock a plain spinner reads as "hung", so this counts up while it waits.
 */
export function Thinking({ label = 'Asking Claude…', className }: { label?: string; className?: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={`flex items-center gap-2 text-[12px] text-faint ${className ?? ''}`}>
      <Spinner className="h-3.5 w-3.5" />
      {label}
      {seconds > 2 && <span className="tnum text-[11px]">{seconds}s</span>}
    </span>
  );
}
