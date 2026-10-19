import { useState } from 'react';
import { Check, Copy, Download, FileDown, ListChecks } from 'lucide-react';
import type { Collection } from '@/types';
import { Segmented, Button } from '@/components/ui/primitives';
import { AuthTab } from '@/components/request/AuthTab';
import { HeadersTab } from '@/components/request/HeadersTab';
import { KVEditor } from '@/components/ui/KVEditor';
import { CodeEditor } from '@/components/ui/Editor';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { useRunner } from '@/store/runner';
import { useRunHistoryFor } from '@/store/runHistory';
import { useOpenApiHistoryFor } from '@/store/openapiHistory';
import { RunHistoryView } from './RunHistoryView';
import { SpecHistoryView } from './SpecHistoryView';
import { renderCollectionDocs } from '@/lib/docs';
import { countByType } from '@/lib/tree';
import { saveFile } from '@/lib/saveFile';
import { toast } from '@/lib/toast';
import { buildScope } from '@/lib/variables';
import { MonitorsTab } from './MonitorsTab';

type DetailTab = 'overview' | 'auth' | 'headers' | 'variables' | 'scripts' | 'docs' | 'history' | 'spec' | 'monitors';
type ScriptPhase = 'pre' | 'test';

const SCRIPT_PLACEHOLDER: Record<ScriptPhase, string> = {
  pre: '// Runs before every request in this collection.\n// pm.environment.set(...), pm.variables.get(...)',
  test: "// Runs after every response in this collection.\n// pm.test('is ok', () => pm.expect(pm.response.code).to.equal(200));",
};

/**
 * A collection's home page — everything that today has no other UI or was
 * scattered across separate modals lives here in one place: default Auth
 * and Headers every request inherits, collection Variables, pre-request/test
 * Scripts, and the generated Docs.
 */
export function CollectionDetailPage({ collection, onExport }: { collection: Collection; onExport: () => void }) {
  const workspace = useActiveWorkspace();
  const updateCollection = useWorkspaces((s) => s.updateCollection);
  const scope = buildScope(workspace, collection);
  const runHistoryCount = useRunHistoryFor(collection.id).length;
  const specHistoryCount = useOpenApiHistoryFor(collection.id).length;
  const [tab, setTab] = useState<DetailTab>('overview');
  const [scriptPhase, setScriptPhase] = useState<ScriptPhase>('pre');
  const [copied, setCopied] = useState(false);

  const { requests: requestCount, folders: folderCount, websockets: wsCount, grpc: grpcCount } = countByType(collection.items);

  const rendered = renderCollectionDocs(collection);
  const copyDocs = () => {
    navigator.clipboard.writeText(rendered);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const exportDocs = async () => {
    const path = await saveFile(`${collection.name}.docs.md`, rendered, 'text/markdown');
    if (path === null) return;
    toast.success('Exported docs', path || `${collection.name}.docs.md`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <input
          value={collection.name}
          onChange={(e) => updateCollection(collection.id, { name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-fg focus:outline-none"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => useRunner.getState().openFor(collection.id, null)}>
            <ListChecks size={13} /> Run
          </Button>
          <Button size="sm" onClick={onExport}>
            <Download size={13} /> Export
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[11px] text-faint">
        <span>
          {requestCount} request{requestCount === 1 ? '' : 's'}
        </span>
        <span>·</span>
        <span>
          {folderCount} folder{folderCount === 1 ? '' : 's'}
        </span>
        {wsCount > 0 && (
          <>
            <span>·</span>
            <span>
              {wsCount} websocket{wsCount === 1 ? '' : 's'}
            </span>
          </>
        )}
        {grpcCount > 0 && (
          <>
            <span>·</span>
            <span>
              {grpcCount} gRPC
            </span>
          </>
        )}
      </div>

      <div className="border-b border-line px-4 py-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'auth', label: 'Auth', dot: collection.auth.type !== 'none' },
            { value: 'headers', label: 'Headers', count: collection.headers.filter((h) => h.enabled && h.key.trim()).length },
            { value: 'variables', label: 'Variables', count: collection.variables.filter((v) => v.key.trim()).length },
            { value: 'scripts', label: 'Scripts', dot: !!(collection.preRequestScript?.trim() || collection.testScript?.trim()) },
            { value: 'docs', label: 'Docs' },
            { value: 'monitors', label: 'Monitors', count: (workspace.monitors ?? []).filter((m) => m.collectionId === collection.id).length },
            { value: 'history', label: 'History', count: runHistoryCount },
            { value: 'spec', label: 'Spec History', count: specHistoryCount },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="flex max-w-2xl flex-col gap-3 p-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-faint">Description</label>
              <textarea
                value={collection.description}
                onChange={(e) => updateCollection(collection.id, { description: e.target.value })}
                placeholder="What this collection is for — shown at the top of its exported docs."
                rows={4}
                className="w-full resize-none rounded-md border border-line bg-surface p-2.5 text-[12.5px] leading-relaxed text-fg focus:border-accent focus:outline-none"
              />
            </div>
            <p className="text-[11.5px] leading-relaxed text-faint">
              Every request here inherits this collection&rsquo;s Auth and Headers by default, and can use its
              Variables — beaten only by the active environment, and beating globals.
            </p>
          </div>
        )}

        {tab === 'auth' && (
          <AuthTab
            auth={collection.auth}
            onChange={(auth) => updateCollection(collection.id, { auth })}
            inheritedFrom={null}
            warning={null}
            canInherit={false}
            scope={scope}
          />
        )}

        {tab === 'headers' && (
          <HeadersTab
            headers={collection.headers}
            autoHeaders={[]}
            onChange={(headers) => updateCollection(collection.id, { headers })}
            resolve={(text) => text}
          />
        )}

        {tab === 'variables' && (
          <div className="p-4">
            <div className="overflow-hidden rounded-md border border-line">
              <KVEditor
                rows={collection.variables}
                onChange={(variables) => updateCollection(collection.id, { variables })}
                showDescription
                secretToggle
              />
            </div>
          </div>
        )}

        {tab === 'scripts' && (
          <div className="flex h-full flex-col p-4">
            <Segmented
              value={scriptPhase}
              onChange={setScriptPhase}
              options={[
                { value: 'pre', label: 'Pre-request', dot: !!collection.preRequestScript?.trim() },
                { value: 'test', label: 'Tests', dot: !!collection.testScript?.trim() },
              ]}
            />
            <p className="mb-2 mt-2 text-[11.5px] leading-relaxed text-faint">
              Runs for every request in this collection, before that request&rsquo;s own {scriptPhase === 'pre' ? 'pre-request' : 'test'} script.
            </p>
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line">
              <CodeEditor
                value={(scriptPhase === 'pre' ? collection.preRequestScript : collection.testScript) ?? ''}
                onChange={(next) => updateCollection(collection.id, scriptPhase === 'pre' ? { preRequestScript: next } : { testScript: next })}
                language="javascript"
                placeholder={SCRIPT_PLACEHOLDER[scriptPhase]}
              />
            </div>
          </div>
        )}

        {tab === 'docs' && (
          <div className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] text-faint">Built from every request&rsquo;s own Docs tab, headers, params and body.</p>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={copyDocs}>
                  {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button size="sm" variant="primary" onClick={exportDocs}>
                  <FileDown size={11} /> Export .md
                </Button>
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-line bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-dim whitespace-pre-wrap">
              {rendered}
            </pre>
          </div>
        )}

        {tab === 'monitors' && <MonitorsTab collection={collection} />}
        {tab === 'history' && <RunHistoryView collectionId={collection.id} />}
        {tab === 'spec' && <SpecHistoryView collectionId={collection.id} />}
      </div>
    </div>
  );
}
