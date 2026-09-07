/** One Server-Sent Event, decoded per the WHATWG spec's field rules (§9.2). */
export interface SseEvent {
  event: string | null;
  data: string;
  id: string | null;
  at: number;
}

/**
 * Feed it raw text as it arrives over the wire; it holds back whatever
 * hasn't reached a line boundary yet and returns only the events that are
 * now complete. A `data:`-only stream (the common case) still produces
 * events — the blank line between records is what ends one, not a
 * particular field being present.
 */
export class SseParser {
  private buffer = '';
  private eventType: string | null = null;
  private dataLines: string[] = [];
  private id: string | null = null;
  private sawField = false;

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let newlineAt: number;
    while ((newlineAt = this.buffer.indexOf('\n')) !== -1) {
      const raw = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

      if (line === '') {
        if (this.sawField) events.push({ event: this.eventType, data: this.dataLines.join('\n'), id: this.id, at: Date.now() });
        this.eventType = null;
        this.dataLines = [];
        this.id = null;
        this.sawField = false;
        continue;
      }
      if (line.startsWith(':')) continue; // comment / keep-alive ping

      const colonAt = line.indexOf(':');
      const field = colonAt === -1 ? line : line.slice(0, colonAt);
      const value = colonAt === -1 ? '' : line.slice(colonAt + 1).replace(/^ /, '');
      this.sawField = true;
      if (field === 'event') this.eventType = value;
      else if (field === 'data') this.dataLines.push(value);
      else if (field === 'id') this.id = value;
      // 'retry' affects reconnection timing only — nothing to show for it here.
    }
    return events;
  }
}
