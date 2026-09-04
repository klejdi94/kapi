import * as YAML from 'yaml';
import { emptyAuth, emptyBody, kv, newCollection, newEnvironment, newRequestNode, withTrailingBlank } from '@/lib/factory';
import type { Collection, Environment, TreeNode } from '@/types';

interface OaOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OaParameter[];
  requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown; examples?: Record<string, { value?: unknown }> }> };
  security?: Record<string, unknown>[];
}
interface OaParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  example?: unknown;
  schema?: { example?: unknown; default?: unknown; type?: string };
}
interface OaDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string };
  servers?: { url: string; description?: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, OaOperation>>;
  components?: { securitySchemes?: Record<string, { type: string; scheme?: string; in?: string; name?: string }> };
  securityDefinitions?: Record<string, { type: string; in?: string; name?: string }>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function looksLikeOpenApi(data: unknown): data is OaDoc {
  const d = data as OaDoc;
  return !!d && typeof d === 'object' && (typeof d.openapi === 'string' || typeof d.swagger === 'string') && typeof d.paths === 'object';
}

export function parseOpenApiText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  return YAML.parse(trimmed);
}

function exampleFor(schema: { example?: unknown; examples?: Record<string, { value?: unknown }> }): unknown {
  if (schema.example !== undefined) return schema.example;
  const examples = schema.examples;
  if (examples) {
    const first = Object.values(examples)[0];
    if (first?.value !== undefined) return first.value;
  }
  return undefined;
}

function sampleFromJsonSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 4) return null;
  const s = schema as { type?: string; properties?: Record<string, unknown>; items?: unknown; example?: unknown; default?: unknown; enum?: unknown[] };
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];
  switch (s.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(s.properties ?? {})) out[key] = sampleFromJsonSchema(value, depth + 1);
      return out;
    }
    case 'array':
      return [sampleFromJsonSchema(s.items, depth + 1)];
    case 'string':
      return '';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

export function importOpenApi(doc: OaDoc): { collection: Collection; environment: Environment | null } {
  const isV3 = typeof doc.openapi === 'string';
  const collection = newCollection(doc.info?.title || 'Imported API');
  collection.description = doc.info?.description || '';

  let baseUrl = '{{baseUrl}}';
  if (isV3 && doc.servers?.[0]?.url) baseUrl = doc.servers[0].url;
  else if (doc.host) baseUrl = `${doc.schemes?.[0] || 'https'}://${doc.host}${doc.basePath || ''}`;

  let environment: Environment | null = null;
  if (!isV3 || !doc.servers?.[0]?.url?.startsWith('http')) {
    // Relative/templated server: give the user a variable to fill in rather
    // than a request that can never resolve.
    environment = newEnvironment(`${collection.name} — servers`);
    environment.variables = withTrailingBlank([kv({ key: 'baseUrl', value: baseUrl.startsWith('http') ? baseUrl : 'https://api.example.com' })]);
    baseUrl = '{{baseUrl}}';
  }

  const items: TreeNode[] = [];

  for (const [path, operations] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = operations[method as keyof typeof operations] as OaOperation | undefined;
      if (!op) continue;

      const node = newRequestNode(op.summary || op.operationId || `${method.toUpperCase()} ${path}`);
      node.request.method = method.toUpperCase();
      // OpenAPI path params use {name}; kapi uses :name.
      node.request.url = `${baseUrl}${path.replace(/\{([^}]+)\}/g, ':$1')}`;
      node.request.auth = emptyAuth('inherit');

      const pathVarNames = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      node.request.pathVars = withTrailingBlank(pathVarNames.map((name) => kv({ key: name, value: '' }))).slice(0, -1);

      const params = (op.parameters ?? []).filter((p) => p.in === 'query');
      const headers = (op.parameters ?? []).filter((p) => p.in === 'header');
      if (params.length) {
        node.request.params = withTrailingBlank(
          params.map((p) => kv({ key: p.name, value: String(p.example ?? p.schema?.example ?? p.schema?.default ?? ''), enabled: !!p.required, description: '' })),
        );
      }
      if (headers.length) {
        node.request.headers = withTrailingBlank(headers.map((h) => kv({ key: h.name, value: String(h.example ?? ''), enabled: !!h.required })));
      }

      const jsonContent = op.requestBody?.content?.['application/json'];
      if (jsonContent) {
        const example = exampleFor(jsonContent) ?? sampleFromJsonSchema(jsonContent.schema);
        node.request.body = { ...emptyBody(), mode: 'json' };
        node.request.body.text.json = JSON.stringify(example, null, 2);
      }

      items.push(node);
    }
  }

  collection.items = items;
  return { collection, environment };
}
