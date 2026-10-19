import { useMemo, useRef, useState } from 'react';
import { FileDown, FileUp, Play, Square, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, IconButton, Field, Input, Segmented } from '@/components/ui/primitives';
import { LoadTestView } from './LoadTestView';
import { useActiveWorkspace, findCollection } from '@/store/workspaces';
import { useRunner } from '@/store/runner';
import { useRunHistory } from '@/store/runHistory';
import { runCollection, targetsFor, type RunnerResult, type RunnerTarget } from '@/lib/runner';
import { locate } from '@/lib/tree';
import { parseCsv } from '@/lib/csv';
import { uid } from '@/lib/factory';
import { methodVar } from '@/lib/methodColor';
import { saveFile } from '@/lib/saveFile';
import { toast } from '@/lib/toast';
import clsx from 'clsx';

const STATUS_DOT: Record<RunnerResult['status'], string> = {
  passed: 'bg-ok',
  failed: 'bg-danger',
  error: 'bg-danger',
  running: 'bg-faint',
};

function ResultRow({ result }: { result: RunnerResult }) {
  const failedTests = result.tests.filter((t) => !t.passed).length;
  return (
    <div className="flex items-start gap-2 border-b border-line/60 px-3 py-2">
      <span className={clsx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[result.status])} />
      <span
        className="mt-0.5 w-14 shrink-0 text-[10.5px] font-bold uppercase tracking-wide"
        style={{ color: methodVar(result.method) }}
      >
        {result.method}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px] text-fg">
          {result.path.length > 0 && <span className="truncate text-faint">{result.path.join(' / ')} /</span>}
          <span className="truncate font-medium">{result.name}</span>
        </div>
        {result.errorMessage && <div className="mt-0.5 font-mono text-[11px] text-danger">{result.errorMessage}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[11px] text-faint">
        {result.tests.length > 0 && (
          <span className={failedTests ? 'text-danger' : 'text-ok'}>
            {result.tests.length - failedTests}/{result.tests.length} tests
          </span>
        )}
        {result.httpStatus !== null && <span>{result.httpStatus}</span>}
        <span>{Math.round(result.durationMs)}ms</span>
      </div>
    </div>
  );
}

/**
 * Runs every request in a collection or folder, in order, for N iterations —
 * optionally driven by a CSV data file (one row per iteration). Reuses the
 * exact pre-request → send → test pipeline a manual send goes through
 * (`src/lib/runner.ts`), so scripts and assertions behave identically.
 */
export function RunnerPanel() {
  const workspace = useActiveWorkspace();
  const runnerOpen = useRunner((s) => s.open);
  const collectionId = useRunner((s) => s.collectionId);
  const scopeNodeId = useRunner((s) => s.scopeNodeId);
  const running = useRunner((s) => s.running);
  const results = useRunner((s) => s.results);
  const close = useRunner((s) => s.close);
  const start = useRunner((s) => s.start);
  const addResult = useRunner((s) => s.addResult);
  const finish = useRunner((s) => s.finish);

  const [mode, setMode] = useState<'run' | 'load'>('run');
  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [dataRows, setDataRows] = useState<Record<string, string>[]>([]);
  const [dataFileName, setDataFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const collection = collectionId ? findCollection(workspace, collectionId) : null;
  const targets: RunnerTarget[] = useMemo(
    () => (collection ? targetsFor(collection, scopeNodeId) : []),
    [collection, scopeNodeId],
  );

  if (!runnerOpen || !collection) return null;

  const totalRuns = targets.length * Math.max(1, iterations);
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'error').length;
  const done = results.length >= totalRuns && totalRuns > 0;

  const onPickFile = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      toast.error('No rows found', 'The file has no data rows kapi could read as CSV.');
      return;
    }
    setDataRows(rows);
    setDataFileName(file.name);
    setIterations(rows.length);
  };

  const clearFile = () => {
    setDataRows([]);
    setDataFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const run = async () => {
    if (!targets.length) {
      toast.error('Nothing to run', 'This collection has no requests.');
      return;
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    start(controller);
    try {
      await runCollection({
        workspaceId: workspace.id,
        collectionId: collection.id,
        targets,
        iterations,
        dataRows,
        delayMs,
        signal: controller.signal,
        onResult: addResult,
      });
    } catch (err) {
      toast.error('Run failed', (err as Error).message);
    } finally {
      finish();
      // Read the store fresh rather than the closed-over `results` — it only
      // reflects the render this function was created in, not what streamed
      // in via `addResult` while the run was in flight.
      const finalResults = useRunner.getState().results;
      if (finalResults.length) {
        const scoped = scopeNodeId ? locate(collection.items, scopeNodeId) : null;
        const scopeName = scoped?.node.type === 'folder' ? scoped.node.name : null;
        useRunHistory.getState().add({
          id: uid(),
          collectionId: collection.id,
          collectionName: collection.name,
          scopeName,
          at: startedAt,
          iterations,
          durationMs: Date.now() - startedAt,
          passed: finalResults.filter((r) => r.status === 'passed').length,
          failed: finalResults.filter((r) => r.status === 'failed').length,
          errored: finalResults.filter((r) => r.status === 'error').length,
          results: finalResults.map((r) => ({
            iteration: r.iteration,
            name: r.name,
            path: r.path,
            method: r.method,
            url: r.url,
            // A saved run is always over by the time this runs — 'running' is
            // only ever a live-UI state — but the type doesn't know that.
            status: r.status === 'running' ? 'error' : r.status,
            httpStatus: r.httpStatus,
            durationMs: r.durationMs,
            errorMessage: r.errorMessage,
            testsPassed: r.tests.filter((t) => t.passed).length,
            testsTotal: r.tests.length,
          })),
        });
      }
    }
  };

  const exportResults = async () => {
    const payload = results.map((r) => ({
      iteration: r.iteration,
      name: r.name,
      path: r.path,
      method: r.method,
      url: r.url,
      status: r.status,
      httpStatus: r.httpStatus,
      durationMs: Math.round(r.durationMs),
      errorMessage: r.errorMessage,
      tests: r.tests,
    }));
    const path = await saveFile(`${collection.name}-run.json`, JSON.stringify(payload, null, 2), 'application/json');
    if (path) toast.success('Run exported', path);
  };

  return (
    <Modal open onClose={close} title={`Run — ${collection.name}${scopeNodeId ? ' (folder)' : ''}`} width={mode === 'load' ? 720 : 620}>
      {!running && (
        <Segmented
          className="mb-3"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'run', label: 'Run' },
            { value: 'load', label: 'Load test' },
          ]}
        />
      )}
      {mode === 'load' ? (
        <LoadTestView collection={collection} scopeNodeId={scopeNodeId} />
      ) : (
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] leading-relaxed text-faint">
          Runs {targets.length} request{targets.length === 1 ? '' : 's'}
          {scopeNodeId ? '' : ' in this collection'}, in order, through the same pre-request and test scripts a
          manual send uses. A request's variable writes carry into the next request and the next iteration.
        </p>

        {!running && !results.length && (
          <div className="flex items-end gap-3">
            <Field label="Iterations" className="w-28">
              <Input
                type="number"
                min={1}
                value={iterations}
                onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))}
                disabled={dataRows.length > 0}
              />
            </Field>
            <Field label="Delay between requests (ms)" className="w-40">
              <Input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Data file" className="flex-1">
              {dataFileName ? (
                <div className="flex h-8 items-center justify-between rounded-md border border-line bg-surface-2 px-2.5 text-[12px] text-fg">
                  <span className="truncate">{dataFileName} · {dataRows.length} rows</span>
                  <IconButton label="Remove data file" onClick={clearFile}>
                    <X size={12} />
                  </IconButton>
                </div>
              ) : (
                <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                  <FileUp size={12} /> Choose CSV…
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
              />
            </Field>
          </div>
        )}

        {(running || results.length > 0) && (
          <div className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px]">
            <span className="text-dim">
              {results.length}/{totalRuns} run
              {results.length > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-ok">{passed} passed</span>
                  {failed > 0 && <> · <span className="font-semibold text-danger">{failed} failed</span></>}
                </>
              )}
            </span>
            {done && (
              <Button size="sm" onClick={exportResults}>
                <FileDown size={12} /> Export results
              </Button>
            )}
          </div>
        )}

        <div className="max-h-80 min-h-[3rem] overflow-y-auto rounded-md border border-line">
          {results.length === 0 ? (
            <div className="flex h-16 items-center justify-center text-[12px] text-faint">
              {running ? 'Starting…' : 'Results will show up here once the run starts.'}
            </div>
          ) : (
            results.map((r) => <ResultRow key={r.id} result={r} />)
          )}
        </div>

        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="danger" onClick={() => useRunner.getState().stop()}>
              <Square size={13} /> Stop
            </Button>
          ) : done ? (
            <Button onClick={() => useRunner.setState({ results: [] })}>Run again</Button>
          ) : (
            <Button variant="primary" onClick={run}>
              <Play size={13} /> Run
            </Button>
          )}
        </div>
      </div>
      )}
    </Modal>
  );
}
