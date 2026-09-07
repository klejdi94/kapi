import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './transport';

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
- This is a single one-shot query with no ability to browse the web or run code — work only from what's in the conversation and your own knowledge, and say so if you're guessing at an API's shape.`;

export function claudeAvailable(): boolean {
  return isDesktop();
}

export async function isClaudeCliInstalled(): Promise<boolean> {
  if (!isDesktop()) return false;
  return invoke<boolean>('kapi_claude_available');
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * One-shot: `claude -p` has no notion of prior turns, so the whole
 * conversation so far is folded into a single prompt. Tools are disabled on
 * the Rust side — this only ever produces text, never touches the filesystem.
 *
 * `context`, when given, is what's currently open in kapi (see
 * `lib/aiContext.ts`) — prepended ahead of the conversation so Claude can
 * answer questions about "this" without the user having to paste it in.
 */
export async function askClaude(history: ChatTurn[], context?: string): Promise<string> {
  const conversation =
    history.length === 1
      ? history[0].text
      : [
          'Continue this conversation. Respond only to the final User message, in the same style as your previous replies (including a kapi-request block when you have enough to propose one).',
          '',
          ...history.map((turn) => `${turn.role === 'user' ? 'User' : 'You'}: ${turn.text}`),
        ].join('\n');

  const prompt = context ? `=== Context from kapi ===\n${context}\n\n=== Conversation ===\n${conversation}` : conversation;
  return invoke<string>('kapi_claude_prompt', { prompt, systemPrompt: SYSTEM_PROMPT });
}
