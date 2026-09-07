import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { askAi, listAvailableAiClis } from '../aiCli';

beforeEach(() => {
  invoke.mockReset();
  // listAvailableAiClis short-circuits to [] outside the desktop app —
  // this marker is what isDesktop() checks for.
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
});

describe('askAi', () => {
  it('sends a single-turn history as-is, prefixed by context when given', async () => {
    invoke.mockResolvedValue('reply');
    await askAi('codex', [{ role: 'user', text: 'hello' }], 'the context');
    expect(invoke).toHaveBeenCalledWith('kapi_ai_prompt', expect.objectContaining({ cli: 'codex' }));
    const prompt = invoke.mock.calls[0][1].prompt as string;
    expect(prompt).toContain('=== Context from kapi ===\nthe context');
    expect(prompt).toContain('hello');
  });

  it('folds multi-turn history into a labeled transcript', async () => {
    invoke.mockResolvedValue('reply');
    await askAi('gemini', [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'answer' },
      { role: 'user', text: 'second' },
    ]);
    const prompt = invoke.mock.calls[0][1].prompt as string;
    expect(prompt).toContain('User: first');
    expect(prompt).toContain('You: answer');
    expect(prompt).toContain('User: second');
  });

  it('passes the selected cli through to the invoke call', async () => {
    invoke.mockResolvedValue('reply');
    await askAi('claude', [{ role: 'user', text: 'hi' }]);
    expect(invoke.mock.calls[0][1].cli).toBe('claude');
  });
});

describe('listAvailableAiClis', () => {
  it('orders results as claude, codex, gemini regardless of what order the backend returns', async () => {
    invoke.mockResolvedValue(['gemini', 'claude']);
    await expect(listAvailableAiClis()).resolves.toEqual(['claude', 'gemini']);
  });

  it('returns an empty list when nothing is installed', async () => {
    invoke.mockResolvedValue([]);
    await expect(listAvailableAiClis()).resolves.toEqual([]);
  });

  it('never calls invoke outside the desktop app', async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    invoke.mockResolvedValue(['claude']);
    await expect(listAvailableAiClis()).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
