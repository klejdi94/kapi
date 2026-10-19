import { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, Play, Square } from 'lucide-react';
import clsx from 'clsx';
import type { Collection } from '@/types';
import { Button, Checkbox, Field, Input, Segmented } from '@/components/ui/primitives';
import { useActiveWorkspace } from '@/store/workspaces';
import { headlessTargetsFor } from '@/cli/headlessRunner';
import { startLoadTest, summarize, type LoadSample, type LoadSummary, type LoadTestRun } from '@/lib/loadTest';
import { memoryCookieJar, withCookieJar } from '@/lib/cookieSend';
import { send } from '@/lib/send';
import { methodVar } from '@/lib/methodColor';
import { saveFile } from '@/lib/saveFile';
import { toast } from '@/lib/toast';

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={clsx('tnum mt-0.5 text-[16px] font-semibold', tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-fg')}>{value}</div>
    </div>
  );
}

/** Requests per second as bars (errors stacked in red), mean latency as a line on its own scale. */
function Timeline({ summary }: { summary: LoadSummary }) {
  const W = 560;
  const H = 96;
  const pad = { l: 34, r: 40, t: 8, b: 18 };
  const buckets = summary.timeline;
  const maxReq = Math.max(1, ...buckets.map((b) => b.requests));
  const maxMs = Math.max(1, ...buckets.map((b) => b.meanMs));
  const bw = (W - pad.l - pad.r) / Math.max(1, buckets.length);
  const y = (v: number, max: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = buckets
    .filter((b) => b.requests)
    .map((b) => `${pad.l + bw * (b.second + 0.5)},${y(b.meanMs, maxMs)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Throughput and latency over time">
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-line)" />
      {buckets.map((b) => {
        const okH = (H - pad.t - pad.b) * ((b.requests - b.errors) / maxReq);
        const errH = (H - pad.t - pad.b) * (b.errors / maxReq);
        const x = pad.l + bw * b.second + bw * 0.15;
        return (
          <g key={b.second}>
            <rect x={x} width={bw * 0.7} y={H - pad.b - okH} height={okH} fill="var(--accent)" opacity={0.55} />
            {errH > 0 && <rect x={x} width={bw * 0.7} y={H - pad.b - okH - errH} height={errH} fill="var(--danger)" opacity={0.8} />}
          </g>
        );
      })}
      {line && <polyline points={line} fill="none" stroke="var(--warn)" strokeWidth={1.5} />}
      <text x={pad.l - 4} y={pad.t + 8} textAnchor="end" fontSize={9} fill="var(--color-faint)">{maxReq}/s</text>
      <text x={W - pad.r + 4} y={pad.t + 8} fontSize={9} fill="var(--warn)">{ms(maxMs)}</text>
      <text x={pad.l} y={H - 4} fontSize={9} fill="var(--color-faint)">0s</text>
      <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize={9} fill="var(--color-faint)">{buckets.length}s</text>
    </svg>
  );
}

/**
 * The Runner's load-test mode: N virtual users running this collection (or
 * folder) concurrently through the same pipeline as a normal run, each with
 * its own variables and cookies. Nothing is written back to the workspace —
 * a load test reads the current environment and globals, it never changes them.
 */
export function LoadTestView({ collection, scopeNodeId }: { collection: Collection; scopeNodeId: string | null }) {
  const workspace = useActiveWorkspace();
  const targets = useMemo(() => headlessTargetsFor(collection, scopeNodeId), [collection, scopeNodeId]);

  const [vus, setVus] = useState(10);
  const [mode, setMode] = useState<'duration' | 'iterations'>('duration');
  const [durationS, setDurationS] = useState(30);
  const [iterations, setIterations] = useState(10);
  const [rampUpS, setRampUpS] = useState(0);
  const [thinkMs, setThinkMs] = useState(0);
  const [runScripts, setRunScripts] = useState(true);

  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<LoadSummary | null>(null);
  const samples = useRef<LoadSample[]>([]);
  const runRef = useRef<LoadTestRun | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    runRef.current?.stop();
    controllerRef.current?.abort();
  }, []);

  const start = async () => {
    if (!targets.length) {
      toast.error('Nothing to run', 'This collection has no requests.');
      return;
    }
    const environment = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId) ?? null;
    const controller = new AbortController();
    controllerRef.current = controller;
    samples.current = [];
    setSummary(summarize([], 1));
    setRunning(true);
    const startedAt = Date.now();
    const run = startLoadTest(
      {
        collection,
        globals: workspace.globals,
        environment,
        targets,
        // Each virtual user gets its own cookie jar, like a separate browser.
        sendFnFor: () => withCookieJar(memoryCookieJar(), (request, scope) => send(request, scope, { signal: controller.signal })),
      },
      {
        virtualUsers: vus,
        durationMs: mode === 'duration' ? durationS * 1000 : undefined,
        iterationsPerUser: mode === 'iterations' ? iterations : undefined,
        rampUpMs: rampUpS * 1000,
        thinkTimeMs: thinkMs,
        runScripts,
      },
      (sample) => samples.current.push(sample),
    );
    runRef.current = run;
    const tick = setInterval(() => setSummary(summarize(samples.current, Date.now() - startedAt)), 500);
    try {
      await run.done;
    } finally {
      clearInterval(tick);
      setSummary(summarize(samples.current, Date.now() - startedAt));
      setRunning(false);
      runRef.current = null;
    }
  };

  const stop = () => {
    runRef.current?.stop();
    controllerRef.current?.abort();
  };

  const exportResults = async () => {
    if (!summary) return;
    const payload = { collection: collection.name, config: { vus, mode, durationS, iterations, rampUpS, thinkMs, runScripts }, summary, samples: samples.current };
    const path = await saveFile(`${collection.name}-load-test.json`, JSON.stringify(payload, null, 2), 'application/json');
    if (path) toast.success('Load test exported', path);
  };

  const num = (setter: (n: number) => void, min = 0) => (e: React.ChangeEvent<HTMLInputElement>) => setter(Math.max(min, Number(e.target.value) || min));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11.5px] leading-relaxed text-faint">
        {targets.length} request{targets.length === 1 ? '' : 's'} per iteration, run by concurrent virtual users. Each user has its own variables
        and cookies; scripts and assertions run as usual, and nothing is written back to your workspace.
      </p>

      {!running && !summary && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-3">
            <Field label="Virtual users">
              <Input type="number" min={1} max={500} value={vus} onChange={num(setVus, 1)} />
            </Field>
            <Field label="Ramp-up (s)">
              <Input type="number" min={0} value={rampUpS} onChange={num(setRampUpS)} />
            </Field>
            <Field label="Think time (ms)">
              <Input type="number" min={0} value={thinkMs} onChange={num(setThinkMs)} />
            </Field>
            <Field label={mode === 'duration' ? 'Duration (s)' : 'Iterations / user'}>
              {mode === 'duration' ? (
                <Input type="number" min={1} value={durationS} onChange={num(setDurationS, 1)} />
              ) : (
                <Input type="number" min={1} value={iterations} onChange={num(setIterations, 1)} />
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'duration', label: 'For a duration' },
                { value: 'iterations', label: 'For N iterations' },
              ]}
            />
            <Checkbox checked={runScripts} onChange={setRunScripts} label="Run pre-request and test scripts" />
          </div>
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-6 gap-2">
            <Stat label="Requests" value={String(summary.requests)} />
            <Stat label="Req/s" value={summary.throughput.toFixed(1)} />
            <Stat label="p50" value={ms(summary.latency.p50)} />
            <Stat label="p95" value={ms(summary.latency.p95)} />
            <Stat label="p99" value={ms(summary.latency.p99)} />
            <Stat label="Errors" value={`${(summary.errorRate * 100).toFixed(1)}%`} tone={summary.requests ? (summary.errorRate ? 'danger' : 'ok') : undefined} />
          </div>
          <div className="rounded-md border border-line p-2">
            <Timeline summary={summary} />
            <div className="mt-1 flex gap-4 px-1 text-[10.5px] text-faint">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent/60" />requests/s</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-danger" />failed or errored</span>
              <span><span className="mr-1 inline-block h-0.5 w-3 bg-warn align-middle" />mean latency</span>
              <span className="ml-auto">{Object.entries(summary.statusCodes).map(([code, n]) => `${code}×${n}`).join('  ')}</span>
            </div>
          </div>
          {summary.byRequest.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-surface-2 text-left text-[10.5px] uppercase tracking-wider text-faint">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Request</th>
                    <th className="px-2 py-1.5 text-right font-medium">Count</th>
                    <th className="px-2 py-1.5 text-right font-medium">p50</th>
                    <th className="px-2 py-1.5 text-right font-medium">p95</th>
                    <th className="px-2 py-1.5 text-right font-medium">Max</th>
                    <th className="px-3 py-1.5 text-right font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byRequest.map((r) => (
                    <tr key={`${r.method} ${r.name}`} className="tnum border-t border-line/60">
                      <td className="px-3 py-1.5">
                        <span className="mr-2 text-[10px] font-bold" style={{ color: methodVar(r.method) }}>{r.method}</span>
                        {r.name}
                      </td>
                      <td className="px-2 py-1.5 text-right">{r.count}</td>
                      <td className="px-2 py-1.5 text-right">{ms(r.p50)}</td>
                      <td className="px-2 py-1.5 text-right">{ms(r.p95)}</td>
                      <td className="px-2 py-1.5 text-right">{ms(r.max)}</td>
                      <td className={clsx('px-3 py-1.5 text-right', r.errorRate ? 'text-danger' : 'text-faint')}>{(r.errorRate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2">
        {running ? (
          <Button variant="danger" onClick={stop}>
            <Square size={13} /> Stop
          </Button>
        ) : summary ? (
          <>
            <Button onClick={exportResults}>
              <FileDown size={12} /> Export results
            </Button>
            <Button onClick={() => setSummary(null)}>New test</Button>
          </>
        ) : (
          <Button variant="primary" onClick={start}>
            <Play size={13} /> Start load test
          </Button>
        )}
      </div>
    </div>
  );
}
