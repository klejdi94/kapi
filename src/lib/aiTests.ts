import { invoke } from '@tauri-apps/api/core';
import type { AiCliName } from './aiCli';
import type { KapiResponse } from '@/types';

const SYSTEM_PROMPT = `You write test scripts for kapi, a desktop API client. Given a real HTTP response, reply with ONLY a JavaScript test script — no prose, no explanation, no markdown fences.

The script runs in a sandbox with a Postman-compatible \`pm\` object:
- pm.response.code — status number
- pm.response.status — status text
- pm.response.responseTime — milliseconds
- pm.response.text() — body as a string
- pm.response.json() — body parsed as JSON (throws if not JSON)
- pm.response.headers.get(name) — a header value, case-insensitive
- pm.response.to.have.status(code), pm.response.to.have.header(name), pm.response.to.be.json, pm.response.to.be.ok
- pm.test(name, fn) — registers an assertion
- pm.expect(actual) — chai-style: .to.equal, .to.eql (deep), .to.be.a('string'|'number'|'boolean'|'object'|'array'), .to.have.property(name[, value]), .to.include, .to.have.lengthOf(n), .to.be.above/.below(n), .to.match(/re/), .to.be.oneOf([...]), .to.exist, .to.be.true/.false/.null, with .not to negate
- pm.environment.set(key, value) / pm.collectionVariables.set(...) / pm.globals.set(...)
- console.log(...)

Rules:
- Use ONLY the API listed above. There is no require(), no lodash, no setTimeout.
- Write 3-6 assertions that would catch a real regression: status code, a content-type header, the shape of the body (field presence and types), and response time when it is meaningfully fast.
- Assert on structure and types, never on volatile exact values like timestamps, generated ids, or counts that will change between runs.
- Every assertion goes inside pm.test('descriptive name', () => { ... }).
- Output the script text and nothing else.`;

const BODY_SAMPLE_LIMIT = 4000;

function stripFences(text: string): string {
  const fenced = text.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/** Asks a local AI CLI (Claude, Codex or Gemini) for `pm.test(...)` assertions describing this response. */
export async function generateTestScript(response: KapiResponse, cli: AiCliName): Promise<string> {
  const body = response.binary
    ? '<binary body — assert on status and headers only>'
    : response.text.slice(0, BODY_SAMPLE_LIMIT) + (response.text.length > BODY_SAMPLE_LIMIT ? '\n… (truncated)' : '');

  const sentBody = response.sent.bodyText?.slice(0, 1000) ?? '';

  const prompt = [
    'Write a kapi test script for this response.',
    '',
    '=== Request that was sent ===',
    `${response.sent.method} ${response.sent.url}`,
    ...response.sent.headers.map(([key, value]) => `  ${key}: ${value}`),
    ...(sentBody ? ['', `Request body (${response.sent.bodyKind}):`, sentBody] : []),
    '',
    '=== Response that came back ===',
    `Status: ${response.status} ${response.statusText}`,
    `Time: ${Math.round(response.timings.total)}ms`,
    `Size: ${response.size.body} bytes`,
    'Headers:',
    ...response.headers.map(([key, value]) => `  ${key}: ${value}`),
    '',
    'Response body:',
    body,
    '',
    'Base the assertions on the actual response body above, not on assumptions about the API.',
  ].join('\n');

  const reply = await invoke<string>('kapi_ai_prompt', { cli, prompt, systemPrompt: SYSTEM_PROMPT });
  return stripFences(reply);
}
