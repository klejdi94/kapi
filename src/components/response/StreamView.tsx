import { useEffect, useRef } from 'react';
import { Radio } from 'lucide-react';
import type { SseEvent } from '@/lib/sse';
import { EmptyState } from '@/components/ui/primitives';

/** Live Server-Sent Events, in arrival order — each one rendered as soon as its blank-line terminator shows up, not after the connection closes. */
export function StreamView({ events, loading }: { events: SseEvent[]; loading: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: loading ? 'auto' : 'smooth' });
  }, [events.length, loading]);

  if (!events.length) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={<Radio size={22} />}
          title={loading ? 'Waiting for the first event…' : 'No events'}
          detail="Server-Sent Events show up here as they arrive, live — no waiting for the connection to close."
        />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-3 font-mono text-[12px] leading-relaxed">
      {events.map((event, i) => (
        <div key={i} className="mb-2 border-b border-line/60 pb-2 last:border-0">
          <div className="mb-0.5 flex items-center gap-2 text-[10.5px] text-faint">
            {event.event && <span className="rounded bg-accent/15 px-1.5 py-0.5 font-sans text-accent">{event.event}</span>}
            {event.id && <span>id: {event.id}</span>}
          </div>
          <pre className="whitespace-pre-wrap text-dim">{event.data}</pre>
        </div>
      ))}
      {loading && (
        <div className="dot-pulse flex items-center gap-1 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        </div>
      )}
    </div>
  );
}
