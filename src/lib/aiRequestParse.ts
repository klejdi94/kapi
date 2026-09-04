import type { RequestDef } from '@/types';
import { newRequest, emptyAuth, emptyBody, kv, withTrailingBlank } from './factory';

interface ParsedAiRequest {
  method: string;
  url: string;
  headers?: { key: string; value: string }[];
  bodyMode?: 'none' | 'json' | 'xml' | 'text' | 'urlencoded';
  body?: string;
}

/** Pulls the ```kapi-request fenced block out of an assistant reply, if any. */
export function extractAiRequest(text: string): RequestDef | null {
  const match = /```kapi-request\s*\n([\s\S]*?)```/.exec(text);
  if (!match) return null;
  let parsed: ParsedAiRequest;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  if (!parsed.method || !parsed.url) return null;

  const request = newRequest({ method: parsed.method.toUpperCase(), url: parsed.url, auth: emptyAuth('none') });
  if (parsed.headers?.length) {
    request.headers = withTrailingBlank(parsed.headers.filter((h) => h.key).map((h) => kv({ key: h.key, value: h.value ?? '' })));
  }
  if (parsed.bodyMode && parsed.bodyMode !== 'none' && parsed.body) {
    request.body = { ...emptyBody(), mode: parsed.bodyMode };
    if (parsed.bodyMode === 'json' || parsed.bodyMode === 'xml' || parsed.bodyMode === 'text') {
      request.body.text[parsed.bodyMode] = parsed.body;
    } else if (parsed.bodyMode === 'urlencoded') {
      request.body.urlencoded = withTrailingBlank(
        parsed.body.split('&').filter(Boolean).map((pair) => {
          const [key, value = ''] = pair.split('=');
          return kv({ key: decodeURIComponent(key), value: decodeURIComponent(value) });
        }),
      );
    }
  }
  return request;
}

/** The reply text with the JSON block stripped, for display in the chat log. */
export function stripAiRequestBlock(text: string): string {
  return text.replace(/```kapi-request\s*\n[\s\S]*?```/, '').trim();
}
