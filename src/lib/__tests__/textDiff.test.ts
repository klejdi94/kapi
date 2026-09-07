import { describe, it, expect } from 'vitest';
import { diffLines } from '../textDiff';

describe('diffLines', () => {
  it('marks unchanged lines as context and changed ones as add/remove', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('returns all-context lines for identical text', () => {
    expect(diffLines('same', 'same')).toEqual([{ kind: 'context', text: 'same' }]);
  });

  it('handles a pure addition', () => {
    expect(diffLines('a', 'a\nb')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('handles a pure removal', () => {
    expect(diffLines('a\nb', 'a')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
    ]);
  });
});
