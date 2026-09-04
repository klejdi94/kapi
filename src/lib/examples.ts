import type { HttpMethod, KapiResponse, SavedExample } from '@/types';
import { uid } from './factory';
import { statusText as lookupStatusText } from './format';

export function responseToExample(response: KapiResponse, name: string): SavedExample {
  return {
    id: uid(),
    name,
    status: response.status,
    headers: response.headers,
    body: response.text,
    savedAt: Date.now(),
  };
}

/** Replays a saved example as if it were a live response — no request is sent. */
export function exampleToResponse(example: SavedExample, method: HttpMethod, url: string): KapiResponse {
  const contentType = example.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? 'text/plain';
  return {
    id: uid(),
    status: example.status,
    statusText: lookupStatusText(example.status),
    headers: example.headers,
    text: example.body,
    blob: new Blob([example.body], { type: contentType }),
    contentType,
    size: { headers: 0, body: new TextEncoder().encode(example.body).length },
    timings: { ttfb: 0, total: 0 },
    finalUrl: url,
    redirected: false,
    binary: false,
    receivedAt: example.savedAt,
    sent: { method, url, headers: [], bodyText: null, bodyKind: 'none' },
  };
}
