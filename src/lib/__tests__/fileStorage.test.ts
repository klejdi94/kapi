import { beforeEach, describe, expect, it, vi } from 'vitest';

const disk = new Map<string, string>();
const writes: { path: string; backup: boolean }[] = [];

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: async () => '/data',
  join: async (...parts: string[]) => parts.join('/'),
}));
vi.mock('../transport', () => ({ isDesktop: () => true }));
vi.mock('../toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../fs', () => ({
  pathExists: async (path: string) => disk.has(path),
  readTextFile: async (path: string) => {
    if (!disk.has(path)) throw new Error('ENOENT');
    return disk.get(path)!;
  },
  writeTextFile: async (path: string, contents: string, options: { backup?: boolean } = {}) => {
    writes.push({ path, backup: options.backup ?? false });
    if (options.backup && disk.has(path)) disk.set(`${path}.bak`, disk.get(path)!);
    disk.set(path, contents);
  },
}));

const { fileJSONStorage, flushPendingWrites } = await import('../fileStorage');
// Under Vite's dev flag (which vitest sets) data lives in a `dev` subfolder.
const dir = import.meta.env.DEV ? '/data/dev' : '/data';

describe('fileJSONStorage', () => {
  beforeEach(() => {
    disk.clear();
    writes.length = 0;
  });

  it('flushes pending writes on demand, with a backup', async () => {
    fileJSONStorage.setItem('kapi.a', '{"v":1}');
    expect(disk.has(`${dir}/kapi.a.json`)).toBe(false); // still debounced
    await flushPendingWrites();
    expect(disk.get(`${dir}/kapi.a.json`)).toBe('{"v":1}');
    expect(writes).toEqual([{ path: `${dir}/kapi.a.json`, backup: true }]);
  });

  it('falls back to the .bak copy when the main file is damaged', async () => {
    disk.set(`${dir}/kapi.b.json`, '{"v":2'); // truncated
    disk.set(`${dir}/kapi.b.json.bak`, '{"v":1}');
    expect(await fileJSONStorage.getItem('kapi.b')).toBe('{"v":1}');
  });

  it('sets a damaged file aside when there is no usable backup', async () => {
    disk.set(`${dir}/kapi.c.json`, 'not json');
    expect(await fileJSONStorage.getItem('kapi.c')).toBeNull();
    const aside = [...disk.keys()].find((k) => k.startsWith(`${dir}/kapi.c.json.damaged-`));
    expect(aside).toBeDefined();
    expect(disk.get(aside!)).toBe('not json');
  });
});
