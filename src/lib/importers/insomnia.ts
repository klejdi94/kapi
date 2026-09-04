import { emptyAuth, emptyBody, kv, newCollection, newRequestNode, withTrailingBlank } from '@/lib/factory';
import type { Collection } from '@/types';

/** Insomnia v4 export: a flat `resources` array linked by `_id`/`parentId`. */
interface InsomniaResource {
  _type: string;
  _id: string;
  parentId?: string;
  name?: string;
  method?: string;
  url?: string;
  headers?: { name: string; value: string; disabled?: boolean }[];
  parameters?: { name: string; value: string; disabled?: boolean }[];
  body?: { mimeType?: string; text?: string };
}
interface InsomniaExport {
  resources?: InsomniaResource[];
}

export function looksLikeInsomnia(data: unknown): data is InsomniaExport {
  const d = data as InsomniaExport;
  return !!d && typeof d === 'object' && Array.isArray(d.resources) && d.resources.some((r) => r._type === 'request');
}

export function importInsomnia(doc: InsomniaExport, name = 'Imported from Insomnia'): Collection {
  const collection = newCollection(name);
  const requests = (doc.resources ?? []).filter((r) => r._type === 'request');

  collection.items = requests.map((r) => {
    const node = newRequestNode(r.name || 'Request');
    node.request.method = (r.method || 'GET').toUpperCase();
    node.request.url = r.url || '';
    node.request.auth = emptyAuth('none');
    if (r.headers?.length) {
      node.request.headers = withTrailingBlank(r.headers.map((h) => kv({ key: h.name, value: h.value, enabled: !h.disabled })));
    }
    if (r.parameters?.length) {
      node.request.params = withTrailingBlank(r.parameters.map((p) => kv({ key: p.name, value: p.value, enabled: !p.disabled })));
    }
    if (r.body?.text) {
      const mime = r.body.mimeType || '';
      node.request.body = { ...emptyBody(), mode: mime.includes('json') ? 'json' : 'text' };
      if (mime.includes('json')) node.request.body.text.json = r.body.text;
      else node.request.body.text.text = r.body.text;
    }
    return node;
  });

  return collection;
}
