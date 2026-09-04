import { useState } from 'react';
import { CodeEditor } from '@/components/ui/Editor';
import { Segmented } from '@/components/ui/primitives';

type Phase = 'pre' | 'test';

interface Snippet {
  label: string;
  code: string;
}

const PRE_SNIPPETS: Snippet[] = [
  { label: 'Set an environment variable', code: `pm.environment.set('token', 'value');` },
  { label: 'Read a variable', code: `const base = pm.variables.get('base');\nconsole.log('base is', base);` },
  { label: 'Timestamp', code: `pm.environment.set('now', Date.now());` },
  { label: 'Random id', code: `pm.environment.set('requestId', crypto.randomUUID());` },
];

const TEST_SNIPPETS: Snippet[] = [
  { label: 'Status is 200', code: `pm.test('status is 200', () => {\n  pm.expect(pm.response.code).to.equal(200);\n});` },
  {
    label: 'Response is fast',
    code: `pm.test('responds under 500ms', () => {\n  pm.expect(pm.response.responseTime < 500).to.equal(true);\n});`,
  },
  { label: 'Body contains text', code: `pm.test('body mentions kapi', () => {\n  pm.expect(pm.response.text()).to.include('kapi');\n});` },
  {
    label: 'Check a JSON field',
    code: `pm.test('has an id', () => {\n  const body = pm.response.json();\n  pm.expect(typeof body.id).to.equal('string');\n});`,
  },
  { label: 'Save a field to the environment', code: `pm.environment.set('token', pm.response.json().token);` },
];

const PLACEHOLDER: Record<Phase, string> = {
  pre: '// Runs before the request is sent.\n// pm.environment.set(...), pm.variables.get(...), console.log(...)',
  test: "// Runs after the response arrives.\n// pm.test('name', () => { pm.expect(pm.response.code).to.equal(200); });",
};

/**
 * Postman-compatible `pm` scripts for one request. The collection's own scripts
 * run first — this editor only covers the request-level half.
 */
export function ScriptsTab({
  preRequestScript,
  testScript,
  onChange,
  collectionHasScripts,
}: {
  preRequestScript: string;
  testScript: string;
  onChange: (patch: { preRequestScript?: string; testScript?: string }) => void;
  collectionHasScripts: { pre: boolean; test: boolean };
}) {
  const [phase, setPhase] = useState<Phase>('test');
  const value = phase === 'pre' ? preRequestScript : testScript;
  const snippets = phase === 'pre' ? PRE_SNIPPETS : TEST_SNIPPETS;

  const set = (next: string) => onChange(phase === 'pre' ? { preRequestScript: next } : { testScript: next });
  const append = (code: string) => set(value.trim() ? `${value.replace(/\s+$/, '')}\n\n${code}\n` : `${code}\n`);
  const inheritsFromCollection = phase === 'pre' ? collectionHasScripts.pre : collectionHasScripts.test;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <Segmented
          value={phase}
          onChange={setPhase}
          options={[
            { value: 'pre', label: 'Pre-request', dot: !!preRequestScript.trim() },
            { value: 'test', label: 'Tests', dot: !!testScript.trim() },
          ]}
        />
        {inheritsFromCollection && (
          <span className="text-[11px] text-faint">Collection script runs first</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden">
          <CodeEditor value={value} onChange={set} language="javascript" placeholder={PLACEHOLDER[phase]} />
        </div>
        <div className="w-52 shrink-0 overflow-y-auto border-l border-line p-2">
          <div className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Snippets</div>
          {snippets.map((snippet) => (
            <button
              key={snippet.label}
              onClick={() => append(snippet.code)}
              className="block w-full rounded px-2 py-1.5 text-left text-[11.5px] leading-snug text-dim hover:bg-surface-2 hover:text-fg"
            >
              {snippet.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
