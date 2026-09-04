import { emptyAuth, emptyBody, kv, newCollection, newEnvironment, newFolder, newRequestNode, withTrailingBlank } from '@/lib/factory';
import type { AuthConfig, Collection, Environment, KV, TreeNode } from '@/types';

/** Minimal shape of what we read from a Postman v2.1 collection export. */
interface PmVariable { key?: string; value?: string; type?: string; disabled?: boolean; description?: string }
interface PmHeader { key: string; value: string; disabled?: boolean; description?: string }
interface PmUrl { raw?: string; query?: { key: string; value?: string; disabled?: boolean }[] }
interface PmAuth {
  type: string;
  bearer?: { key: string; value: string }[];
  basic?: { key: string; value: string }[];
  apikey?: { key: string; value: string }[];
}
interface PmBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'graphql' | 'file';
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: { key: string; value: string; disabled?: boolean }[];
  formdata?: { key: string; value?: string; type?: string; disabled?: boolean; src?: string }[];
  graphql?: { query: string; variables?: string };
}
interface PmRequest {
  method?: string;
  header?: PmHeader[];
  url?: PmUrl | string;
  body?: PmBody;
  auth?: PmAuth;
}
interface PmItem {
  name: string;
  item?: PmItem[];
  request?: PmRequest;
  auth?: PmAuth;
  variable?: PmVariable[];
}
interface PmCollection {
  info?: { name?: string; description?: string };
  item?: PmItem[];
  variable?: PmVariable[];
  auth?: PmAuth;
}
interface PmEnvironment {
  name?: string;
  values?: { key: string; value: string; enabled?: boolean; description?: string }[];
}

export function looksLikePostmanCollection(data: unknown): data is PmCollection {
  const d = data as PmCollection;
  return !!d && typeof d === 'object' && Array.isArray(d.item);
}

export function looksLikePostmanEnvironment(data: unknown): data is PmEnvironment {
  const d = data as PmEnvironment;
  return !!d && typeof d === 'object' && Array.isArray(d.values) && !Array.isArray((d as PmCollection).item);
}

function toVars(vars?: PmVariable[]): KV[] {
  const rows = (vars ?? []).filter((v) => v.key).map((v) => kv({ key: v.key!, value: v.value ?? '', enabled: !v.disabled, description: v.description }));
  return withTrailingBlank(rows);
}

function toHeaders(headers?: PmHeader[]): KV[] {
  const rows = (headers ?? []).map((h) => kv({ key: h.key, value: h.value, enabled: !h.disabled, description: h.description }));
  return withTrailingBlank(rows);
}

function toAuth(auth?: PmAuth): AuthConfig {
  if (!auth) return emptyAuth('inherit');
  const find = (arr: { key: string; value: string }[] | undefined, key: string) => arr?.find((a) => a.key === key)?.value ?? '';
  switch (auth.type) {
    case 'bearer':
      return { ...emptyAuth('bearer'), type: 'bearer', bearer: { token: find(auth.bearer, 'token') } };
    case 'basic':
      return { ...emptyAuth('basic'), type: 'basic', basic: { username: find(auth.basic, 'username'), password: find(auth.basic, 'password') } };
    case 'apikey':
      return {
        ...emptyAuth('apikey'),
        type: 'apikey',
        apikey: { key: find(auth.apikey, 'key'), value: find(auth.apikey, 'value'), in: (find(auth.apikey, 'in') as 'header' | 'query') || 'header' },
      };
    case 'noauth':
      return emptyAuth('none');
    default:
      return emptyAuth('inherit');
  }
}

function toBody(body?: PmBody): ReturnType<typeof emptyBody> {
  const out = emptyBody();
  if (!body || !body.mode) return out;
  if (body.mode === 'raw') {
    const lang = body.options?.raw?.language;
    const mode = lang === 'json' ? 'json' : lang === 'xml' ? 'xml' : lang === 'html' ? 'html' : lang === 'javascript' ? 'javascript' : 'text';
    out.mode = mode;
    out.text[mode] = body.raw ?? '';
  } else if (body.mode === 'urlencoded') {
    out.mode = 'urlencoded';
    out.urlencoded = withTrailingBlank((body.urlencoded ?? []).map((r) => kv({ key: r.key, value: r.value, enabled: !r.disabled })));
  } else if (body.mode === 'formdata') {
    out.mode = 'form-data';
    out.formData = withTrailingBlank(
      (body.formdata ?? []).map((r) =>
        r.type === 'file'
          ? kv({ key: r.key, kind: 'file', fileName: r.src, enabled: !r.disabled })
          : kv({ key: r.key, value: r.value ?? '', enabled: !r.disabled }),
      ),
    );
  } else if (body.mode === 'graphql') {
    out.mode = 'graphql';
    out.graphql = { query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '{}' };
  }
  return out;
}

function urlToString(url?: PmUrl | string): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  return url.raw ?? '';
}

function toItems(items: PmItem[]): TreeNode[] {
  return items.map((item) => {
    if (item.item) {
      const folder = newFolder(item.name);
      folder.auth = toAuth(item.auth);
      folder.items = toItems(item.item);
      return folder;
    }
    const node = newRequestNode(item.name);
    const req = item.request ?? {};
    node.request.method = (req.method ?? 'GET').toUpperCase();
    node.request.url = urlToString(req.url);
    node.request.headers = toHeaders(req.header);
    node.request.auth = toAuth(req.auth);
    node.request.body = toBody(req.body);
    const query = typeof req.url === 'object' ? req.url.query : undefined;
    if (query?.length) {
      node.request.params = withTrailingBlank(query.map((q) => kv({ key: q.key, value: q.value ?? '', enabled: !q.disabled })));
    }
    return node;
  });
}

export function importPostmanCollection(data: PmCollection): Collection {
  const collection = newCollection(data.info?.name || 'Imported collection');
  collection.description = data.info?.description || '';
  collection.auth = toAuth(data.auth);
  collection.variables = toVars(data.variable);
  collection.items = toItems(data.item ?? []);
  return collection;
}

export function importPostmanEnvironment(data: PmEnvironment): Environment {
  const env = newEnvironment(data.name || 'Imported environment');
  env.variables = withTrailingBlank(
    (data.values ?? []).map((v) => kv({ key: v.key, value: v.value, enabled: v.enabled !== false, description: v.description })),
  );
  return env;
}
