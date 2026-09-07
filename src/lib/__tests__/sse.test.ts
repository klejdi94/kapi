import { describe, it, expect } from 'vitest';
import { SseParser } from '../sse';

describe('SseParser', () => {
  it('parses a single complete event delivered in one chunk', () => {
    const parser = new SseParser();
    const events = parser.push('event: message\ndata: hello\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'message', data: 'hello' });
  });

  it('assembles multi-line data fields with newlines preserved', () => {
    const parser = new SseParser();
    const events = parser.push('data: line one\ndata: line two\n\n');
    expect(events[0].data).toBe('line one\nline two');
  });

  it('holds a partial event across chunks until the blank line arrives', () => {
    const parser = new SseParser();
    expect(parser.push('data: partial')).toEqual([]);
    const events = parser.push('\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('partial');
  });

  it('splits a chunk containing more than one event', () => {
    const parser = new SseParser();
    const events = parser.push('data: a\n\ndata: b\n\n');
    expect(events.map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('ignores comment lines starting with a colon', () => {
    const parser = new SseParser();
    const events = parser.push(': keep-alive\ndata: real\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('real');
  });

  it('captures the id field', () => {
    const parser = new SseParser();
    const events = parser.push('id: 42\ndata: x\n\n');
    expect(events[0].id).toBe('42');
  });

  it('handles CRLF line endings the same as LF', () => {
    const parser = new SseParser();
    const events = parser.push('data: crlf\r\n\r\n');
    expect(events[0].data).toBe('crlf');
  });
});
