import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './transport';

export type AiCliName = 'claude' | 'codex' | 'gemini';

export const AI_CLI_LABELS: Record<AiCliName, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

/**
 * Claude's one-shot mode fully disables its tools (`--tools ""`) — no
 * filesystem access at all. Codex and Gemini have no equivalent all-off
 * switch (verified against real installs): their strictest available mode
 * only blocks writes, so they can still read local files as part of
 * answering. Shown next to the picker whenever a non-Claude CLI is selected.
 */
export const AI_CLI_SANDBOX_NOTE: Partial<Record<AiCliName, string>> = {
  codex: 'Runs read-only — Codex may still read local files while answering, unlike Claude’s fully tool-less mode.',
  gemini: 'Runs read-only — Gemini may still read local files while answering, unlike Claude’s fully tool-less mode.',
};

const SYSTEM_PROMPT = `You help build HTTP API requests inside kapi, a desktop API client. The person describes what they want to call in plain English (an existing API's docs, a curl command, "an endpoint like X", etc.).

The user's message may be preceded by a "Context from kapi" section showing the request and/or response currently open in the app (and, on failure, the error kapi reported). Use it to answer questions like "why did this fail?", "explain this response", or "write a pre-request script for this" — but don't restate it back unless asked, and don't assume every message is about it.

When asked for a pre-request or test script, reply with ONLY a fenced \`\`\`javascript block containing the script, no prose — it runs against a Postman-compatible \`pm\` object (pm.environment/globals/collectionVariables get/set/unset, pm.request, pm.response with code/status/headers/responseTime/text()/json(), pm.test(name, fn), pm.expect(actual).to.equal/include, console.log). Use only that API — no chai, no pm.response.to.have.status().

Reply conversationally and briefly. Whenever you have enough information to propose a concrete request, end your reply with a fenced code block labeled kapi-request containing ONLY minified JSON in exactly this shape:

\`\`\`kapi-request
{"method":"GET","url":"https://api.example.com/v1/things","headers":[{"key":"Accept","value":"application/json"}],"bodyMode":"none","body":""}
\`\`\`

Rules for that block:
- "method" is an HTTP method in caps.
- "url" is a full absolute URL. Use {{variable}} placeholders for anything like an API key, base URL, or id you don't know — never invent a fake credential.
- "headers" is an array of {"key","value"} pairs. Omit Content-Type unless it's unusual — kapi adds the normal one automatically based on bodyMode.
- "bodyMode" is one of: none, json, xml, text, urlencoded. Use "json" for typical REST bodies.
- "body" is the exact text of the body (pretty-printed JSON is fine for bodyMode "json"), or "" when bodyMode is "none".
- Emit at most one kapi-request block per reply, only once you're confident, and never inside a sentence — it must be its own fenced block.
- This is a single one-shot query with no ability to browse the web or run code beyond what your own sandbox allows — work only from what's in the conversation and your own knowledge, and say so if you're guessing at an API's shape.`;

/** Desktop-only: shelling out to a local CLI isn't possible from a plain browser tab. */
export function aiCliFeatureAvailable(): boolean {
  return isDesktop();
}

/** Which of claude/codex/gemini are actually installed on this machine, most-preferred first. */
export async function listAvailableAiClis(): Promise<AiCliName[]> {
  if (!isDesktop()) return [];
  const found = await invoke<string[]>('kapi_ai_list_available');
  const preferredOrder: AiCliName[] = ['claude', 'codex', 'gemini'];
  return preferredOrder.filter((name) => found.includes(name));
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * One-shot: none of these CLIs keep conversation state across invocations
 * here, so the whole history so far is folded into a single prompt each
 * time. `context`, when given, is what's currently open in kapi (see
 * `lib/aiContext.ts`) — prepended ahead of the conversation so the CLI can
 * answer questions about "this" without the user having to paste it in.
 */
export async function askAi(cli: AiCliName, history: ChatTurn[], context?: string): Promise<string> {
  const conversation =
    history.length === 1
      ? history[0].text
      : [
          'Continue this conversation. Respond only to the final User message, in the same style as your previous replies (including a kapi-request block when you have enough to propose one).',
          '',
          ...history.map((turn) => `${turn.role === 'user' ? 'User' : 'You'}: ${turn.text}`),
        ].join('\n');

  const prompt = context ? `=== Context from kapi ===\n${context}\n\n=== Conversation ===\n${conversation}` : conversation;
  return invoke<string>('kapi_ai_prompt', { cli, prompt, systemPrompt: SYSTEM_PROMPT });
}
