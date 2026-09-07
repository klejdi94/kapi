import { describe, it, expect } from 'vitest';
import { parseDotenv } from '../dotenv';

describe('parseDotenv', () => {
  it('parses KEY=value pairs, skipping comments and blank lines', () => {
    expect(parseDotenv('# comment\nFOO=bar\n\nBAZ=1')).toEqual([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: '1' },
    ]);
  });

  it('strips a leading export and matching quotes', () => {
    expect(parseDotenv('export TOKEN="abc123"\nNAME=\'jane\'')).toEqual([
      { key: 'TOKEN', value: 'abc123' },
      { key: 'NAME', value: 'jane' },
    ]);
  });

  it('splits only on the first = so values containing = survive', () => {
    expect(parseDotenv('URL=https://x.com/a?b=c')).toEqual([{ key: 'URL', value: 'https://x.com/a?b=c' }]);
  });

  it('ignores lines with no =', () => {
    expect(parseDotenv('not a valid line')).toEqual([]);
  });
});
