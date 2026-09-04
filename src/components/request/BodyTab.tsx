import type { BodyConfig, BodyMode } from '@/types';
import { BODY_MODE_LABELS, TEXT_MODES, type TextMode } from '@/lib/body';
import { CodeEditor } from '@/components/ui/Editor';
import { KVEditor } from '@/components/ui/KVEditor';
import { Button, Select } from '@/components/ui/primitives';
import { beautify, languageFor, minifyJson, prettyJson } from '@/lib/format';
import { useRef, useState } from 'react';
import { getFile, putFile } from '@/lib/files';
import { FileUp, Sparkles } from 'lucide-react';

const MODES: BodyMode[] = ['none', 'json', 'text', 'javascript', 'html', 'xml', 'graphql', 'form-data', 'urlencoded', 'binary'];

export function BodyTab({
  body,
  onChange,
  resolve,
  disabledReason,
}: {
  body: BodyConfig;
  onChange: (body: BodyConfig) => void;
  resolve: (text: string) => string;
  disabledReason: string | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const setMode = (mode: BodyMode) => onChange({ ...body, mode });

  const setText = (mode: TextMode, value: string) => {
    onChange({ ...body, text: { ...body.text, [mode]: value } });
    if (mode === 'json') setJsonError(prettyJson(value).error);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <Select value={body.mode} onChange={(e) => setMode(e.target.value as BodyMode)} className="w-44">
          {MODES.map((m) => (
            <option key={m} value={m}>
              {BODY_MODE_LABELS[m]}
            </option>
          ))}
        </Select>

        {body.mode === 'json' && (
          <div className="flex items-center gap-2">
            {jsonError && <span className="text-[11px] text-danger">{jsonError}</span>}
            <Button
              size="sm"
              onClick={() => setText('json', beautify(body.text.json ?? '', 'json'))}
            >
              <Sparkles size={12} /> Beautify
            </Button>
            <Button size="sm" onClick={() => setText('json', minifyJson(body.text.json ?? ''))}>
              Minify
            </Button>
          </div>
        )}
        {(body.mode === 'xml' || body.mode === 'html') && (
          <Button size="sm" onClick={() => setText(body.mode as TextMode, beautify(body.text[body.mode as TextMode] ?? '', body.mode as 'xml' | 'html'))}>
            <Sparkles size={12} /> Beautify
          </Button>
        )}
      </div>

      {disabledReason && (
        <div className="border-b border-line bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn">{disabledReason}</div>
      )}

      <div className="min-h-0 flex-1">
        {body.mode === 'none' && (
          <div className="flex h-full items-center justify-center text-[12px] text-faint">This request has no body.</div>
        )}

        {TEXT_MODES.includes(body.mode as TextMode) && (
          <CodeEditor
            value={body.text[body.mode as TextMode] ?? ''}
            onChange={(v) => setText(body.mode as TextMode, v)}
            language={languageFor(body.mode === 'text' ? 'text/plain' : `application/${body.mode}`)}
            placeholder={body.mode === 'json' ? '{\n  "key": "value"\n}' : 'Request body…'}
          />
        )}

        {body.mode === 'graphql' && (
          <div className="grid h-full grid-rows-[1fr_140px] divide-y divide-line">
            <div className="min-h-0">
              <CodeEditor
                value={body.graphql.query}
                onChange={(query) => onChange({ ...body, graphql: { ...body.graphql, query } })}
                language="javascript"
                placeholder={'query {\n  \n}'}
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-line bg-surface-2 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                Variables
              </div>
              <div className="min-h-0 flex-1">
                <CodeEditor
                  value={body.graphql.variables}
                  onChange={(variables) => onChange({ ...body, graphql: { ...body.graphql, variables } })}
                  language="json"
                  placeholder="{}"
                />
              </div>
            </div>
          </div>
        )}

        {body.mode === 'form-data' && (
          <div className="p-3">
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={body.formData} onChange={(formData) => onChange({ ...body, formData })} showDescription allowFiles resolve={resolve} />
            </div>
          </div>
        )}

        {body.mode === 'urlencoded' && (
          <div className="p-3">
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor rows={body.urlencoded} onChange={(urlencoded) => onChange({ ...body, urlencoded })} showDescription resolve={resolve} />
            </div>
          </div>
        )}

        {body.mode === 'binary' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <button
              onClick={() => fileInput.current?.click()}
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-8 py-6 text-faint hover:border-accent hover:text-accent"
            >
              <FileUp size={22} />
              <span className="text-[12.5px] font-medium">{body.binary?.fileName || 'Choose a file'}</span>
            </button>
            {body.binary?.fileName && !getFile('binary') && (
              <p className="text-[11.5px] text-warn">This file isn't attached in memory anymore — choose it again to send it.</p>
            )}
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                putFile('binary', file);
                onChange({ ...body, binary: { fileName: file.name } });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
