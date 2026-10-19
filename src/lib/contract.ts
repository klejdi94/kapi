import Ajv, { type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ResponseContract } from '@/types';
import type { TestResult } from './scripting';
import { isJsonContentType } from './contractSpec';

export { contractFromOperation, derefSchema } from './contractSpec';

/**
 * Contract testing from an OpenAPI/Swagger spec: when a request was imported
 * or synced from a spec, the documented responses (status → JSON schema) are
 * kept with it, and every response is checked against them — status
 * documented, body is JSON, body matches the schema — without anyone writing
 * a test. Results appear alongside the request's own `pm.test` results.
 */

type Json = Record<string, unknown>;

/**
 * OpenAPI 3.0 and Swagger 2 schemas are a JSON Schema dialect: `nullable`,
 * plus documentation-only keywords. Converted to plain JSON Schema here.
 */
function toJsonSchema(schema: unknown, specVersion: ResponseContract['specVersion']): unknown {
  if (Array.isArray(schema)) return schema.map((item) => toJsonSchema(item, specVersion));
  if (!schema || typeof schema !== 'object') return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema as Json)) {
    if (['example', 'examples', 'xml', 'externalDocs', 'discriminator', 'readOnly', 'writeOnly', 'deprecated', 'x-nullable'].includes(key) && specVersion !== '3.1') continue;
    if (key.startsWith('x-')) continue;
    if (key === 'nullable') continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([name, prop]) => [name, toJsonSchema(prop, specVersion)]));
      continue;
    }
    out[key] = toJsonSchema(value, specVersion);
  }
  const s = schema as Json;
  if (specVersion !== '3.1' && (s.nullable === true || s['x-nullable'] === true)) {
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    else return { anyOf: [out, { type: 'null' }] };
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}

const OPENAPI_FORMATS = ['int32', 'int64', 'float', 'double', 'byte', 'binary', 'password'];

function makeAjv(dialect: '2020' | 'draft7'): Ajv {
  const options = { strict: false, allErrors: true, logger: false as const, validateFormats: true };
  const ajv = dialect === '2020' ? new Ajv2020(options) : new Ajv(options);
  addFormats(ajv);
  for (const format of OPENAPI_FORMATS) ajv.addFormat(format, true);
  return ajv as Ajv;
}

let ajv7: Ajv | null = null;
let ajv2020: Ajv | null = null;
const compiled = new Map<string, ValidateFunction>();

function validatorFor(schema: unknown, specVersion: ResponseContract['specVersion']): ValidateFunction {
  const key = `${specVersion}\u0000${JSON.stringify(schema)}`;
  let validate = compiled.get(key);
  if (!validate) {
    const ajv = specVersion === '3.1' ? (ajv2020 ??= makeAjv('2020')) : (ajv7 ??= makeAjv('draft7'));
    validate = ajv.compile(toJsonSchema(schema, specVersion) as object);
    if (compiled.size > 500) compiled.clear();
    compiled.set(key, validate);
  }
  return validate;
}

function pickResponse(contract: ResponseContract, status: number) {
  const code = String(status);
  return contract.responses[code] ?? contract.responses[`${code[0]}XX`] ?? contract.responses.DEFAULT ?? null;
}

/** Checks one response against a request's contract. Empty when there's no contract or it's turned off. */
export function contractTests(
  contract: ResponseContract | undefined,
  response: { status: number; headers: [string, string][]; text: string; binary?: boolean },
): TestResult[] {
  if (!contract?.enabled) return [];
  const tests: TestResult[] = [];
  const documented = Object.keys(contract.responses);
  const entry = pickResponse(contract, response.status);
  tests.push({
    name: `Contract: status ${response.status} is documented`,
    passed: !!entry,
    error: entry ? null : `The spec documents ${documented.join(', ') || 'no responses'} for this operation`,
  });
  if (!entry?.schema) return tests;

  const contentType = response.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  let body: unknown;
  try {
    if (response.binary || (contentType && !isJsonContentType(contentType))) throw new Error(`Content-Type is ${contentType || 'missing'}`);
    body = JSON.parse(response.text);
  } catch (err) {
    tests.push({ name: 'Contract: body is JSON', passed: false, error: `The spec describes a JSON body, but it couldn't be read as JSON (${(err as Error).message})` });
    return tests;
  }

  try {
    const validate = validatorFor(entry.schema, contract.specVersion);
    const ok = validate(body) as boolean;
    const errors = (validate.errors ?? []).slice(0, 6).map((e) => `${e.instancePath || '(root)'} ${e.message}${e.params && 'additionalProperty' in e.params ? ` "${String(e.params.additionalProperty)}"` : ''}`);
    tests.push({ name: 'Contract: body matches the schema', passed: ok, error: ok ? null : errors.join('; ') });
  } catch (err) {
    tests.push({ name: 'Contract: body matches the schema', passed: false, error: `The schema in the spec couldn't be compiled: ${(err as Error).message}` });
  }
  return tests;
}
