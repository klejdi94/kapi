import type { AuthConfig, Collection, Environment, KV, TreeNode } from '@/types';

const enabledOnly = (rows: KV[]) => rows.filter((r) => r.enabled && r.key.trim());

function authToPostman(auth: AuthConfig): unknown {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearer: [{ key: 'token', value: auth.bearer?.token ?? '', type: 'string' }] };
    case 'basic':
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: auth.basic?.username ?? '', type: 'string' },
          { key: 'password', value: auth.basic?.password ?? '', type: 'string' },
        ],
      };
    case 'apikey':
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: auth.apikey?.key ?? '', type: 'string' },
          { key: 'value', value: auth.apikey?.value ?? '', type: 'string' },
          { key: 'in', value: auth.apikey?.in ?? 'header', type: 'string' },
        ],
      };
    case 'none':
      return { type: 'noauth' };
    default:
      return undefined; // inherit / jwt / oauth2 / custom have no direct Postman equivalent
  }
}

function requestBodyToPostman(body: import('@/types').BodyConfig) {
  switch (body.mode) {
    case 'json':
      return { mode: 'raw', raw: body.text.json ?? '', options: { raw: { language: 'json' } } };
    case 'xml':
      return { mode: 'raw', raw: body.text.xml ?? '', options: { raw: { language: 'xml' } } };
    case 'html':
      return { mode: 'raw', raw: body.text.html ?? '', options: { raw: { language: 'html' } } };
    case 'javascript':
      return { mode: 'raw', raw: body.text.javascript ?? '', options: { raw: { language: 'javascript' } } };
    case 'text':
      return { mode: 'raw', raw: body.text.text ?? '', options: { raw: { language: 'text' } } };
    case 'graphql':
      return { mode: 'graphql', graphql: { query: body.graphql.query, variables: body.graphql.variables } };
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: enabledOnly(body.urlencoded).map((r) => ({ key: r.key, value: r.value })) };
    case 'form-data':
      return {
        mode: 'formdata',
        formdata: enabledOnly(body.formData).map((r) =>
          r.kind === 'file' ? { key: r.key, type: 'file', src: r.fileName ?? '' } : { key: r.key, value: r.value, type: 'text' },
        ),
      };
    default:
      return undefined;
  }
}

function nodeToPostman(node: TreeNode): unknown {
  if (node.type === 'folder') {
    return {
      name: node.name,
      auth: authToPostman(node.auth),
      item: node.items.map(nodeToPostman),
    };
  }
  const req = node.request;
  return {
    name: node.name,
    request: {
      method: req.method,
      header: enabledOnly(req.headers).map((h) => ({ key: h.key, value: h.value, description: h.description })),
      url: {
        raw: req.url,
        query: enabledOnly(req.params).map((p) => ({ key: p.key, value: p.value })),
      },
      auth: authToPostman(req.auth),
      body: req.body.mode === 'none' ? undefined : requestBodyToPostman(req.body),
    },
  };
}

export function exportPostmanCollection(collection: Collection): object {
  return {
    info: {
      name: collection.name,
      description: collection.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: authToPostman(collection.auth),
    variable: enabledOnly(collection.variables).map((v) => ({ key: v.key, value: v.value })),
    item: collection.items.map(nodeToPostman),
  };
}

export function exportPostmanEnvironment(environment: Environment): object {
  return {
    name: environment.name,
    values: enabledOnly(environment.variables).map((v) => ({ key: v.key, value: v.value, enabled: true, type: 'default' })),
    _postman_variable_scope: 'environment',
  };
}
