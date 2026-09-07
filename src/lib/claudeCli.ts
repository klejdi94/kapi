import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './transport';

/**
 * Used by the AI test-generation feature (`lib/aiTests.ts`), which is
 * Claude-specific. The conversational AI copilot panel talks to any of
 * claude/codex/gemini instead — see `lib/aiCli.ts`.
 */
export async function isClaudeCliInstalled(): Promise<boolean> {
  if (!isDesktop()) return false;
  return invoke<boolean>('kapi_claude_available');
}
