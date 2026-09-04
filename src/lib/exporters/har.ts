import type { HistoryEntry, KapiResponse } from '@/types';

/** HAR 1.2 — enough of it for browser devtools and other tools to import. */
export function exportHar(entries: { request: HistoryEntry; response?: KapiResponse }[]): object {
  return {
    log: {
      version: '1.2',
      creator: { name: 'kapi', version: '1.0' },
      entries: entries.map(({ request, response }) => ({
        startedDateTime: new Date(request.at).toISOString(),
        time: request.duration,
        request: {
          method: request.method,
          url: request.url,
          httpVersion: 'HTTP/1.1',
          headers: request.request.headers.filter((h) => h.enabled).map((h) => ({ name: h.key, value: h.value })),
          queryString: request.request.params.filter((p) => p.enabled).map((p) => ({ name: p.key, value: p.value })),
          cookies: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: response
          ? {
              status: response.status,
              statusText: response.statusText,
              httpVersion: 'HTTP/1.1',
              headers: response.headers.map(([name, value]) => ({ name, value })),
              cookies: [],
              content: { size: response.size.body, mimeType: response.contentType, text: response.text },
              redirectURL: '',
              headersSize: response.size.headers,
              bodySize: response.size.body,
            }
          : {
              status: request.status ?? 0,
              statusText: '',
              httpVersion: 'HTTP/1.1',
              headers: [],
              cookies: [],
              content: { size: 0, mimeType: '', text: '' },
              redirectURL: '',
              headersSize: -1,
              bodySize: -1,
            },
        cache: {},
        timings: { send: 0, wait: request.duration, receive: 0 },
      })),
    },
  };
}
