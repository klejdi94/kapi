import { emptyAuth, emptyBody, kv, newCollection, newRequestNode, withTrailingBlank } from '@/lib/factory';
import type { Collection } from '@/types';

interface HarEntry {
  request: {
    method: string;
    url: string;
    headers?: { name: string; value: string }[];
    queryString?: { name: string; value: string }[];
    postData?: { mimeType?: string; text?: string };
  };
}
interface HarDoc {
  log?: { entries?: HarEntry[] };
}

export function looksLikeHar(data: unknown): data is HarDoc {
  const d = data as HarDoc;
  return !!d && typeof d === 'object' && Array.isArray(d.log?.entries);
}

export function importHar(doc: HarDoc, name = 'Imported from HAR'): Collection {
  const collection = newCollection(name);
  collection.items = (doc.log?.entries ?? []).map((entry, i) => {
    const req = entry.request;
    const node = newRequestNode(safeUrlLabel(req.url, i));
    node.request.method = req.method.toUpperCase();
    node.request.url = req.url;
    node.request.auth = emptyAuth('none');
    if (req.headers?.length) {
      node.request.headers = withTrailingBlank(
        req.headers.filter((h) => !h.name.startsWith(':')).map((h) => kv({ key: h.name, value: h.value })),
      );
    }
    if (req.postData?.text) {
      const mime = req.postData.mimeType || '';
      node.request.body = { ...emptyBody(), mode: mime.includes('json') ? 'json' : 'text' };
      if (mime.includes('json')) node.request.body.text.json = req.postData.text;
      else node.request.body.text.text = req.postData.text;
    }
    return node;
  });
  return collection;
}

function safeUrlLabel(url: string, index: number): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? u.host : u.pathname;
  } catch {
    return `Request ${index + 1}`;
  }
}
