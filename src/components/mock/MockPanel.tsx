import { useEffect, useState } from 'react';
import { ChevronRight, Copy, Play, Plus, Server, Square, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { HTTP_METHODS } from '@/types';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { useMockServerState } from '@/store/mockServerState';
import { newMockRoute } from '@/lib/factory';
import { mockAvailable, onMockHit, startMockServer, stopMockServer } from '@/lib/mock';
import { Button, IconButton, Badge, EmptyState, Select } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/ui/Editor';
import { languageFor } from '@/lib/format';
import { toast } from '@/lib/toast';
import { methodVar } from '@/lib/methodColor';

export function MockPanel() {
  const workspace = useActiveWorkspace();
  const setMockServer = useWorkspaces((s) => s.setMockServer);
  const { running, port, hits, setRunning, addHit, clearHits } = useMockServerState();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const config = workspace.mockServer;

  useEffect(() => {
    const unlisten = onMockHit(addHit);
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mockAvailable()) {
    return (
      <EmptyState
        icon={<Server size={22} />}
        title="The mock server needs the desktop app"
        detail="Running a real local server isn't possible from a plain browser tab."
      />
    );
  }

  const setRoutes = (routes: typeof config.routes) => setMockServer({ ...config, routes });
  const setPort = (portValue: number) => setMockServer({ ...config, port: portValue });

  const addRoute = () => {
    const route = newMockRoute();
    setRoutes([...config.routes, route]);
    setExpandedId(route.id);
  };

  const updateRoute = (id: string, patch: Partial<(typeof config.routes)[number]>) =>
    setRoutes(config.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const deleteRoute = (id: string) => setRoutes(config.routes.filter((r) => r.id !== id));

  const duplicateRoute = (id: string) => {
    const route = config.routes.find((r) => r.id === id);
    if (!route) return;
    const copy = newMockRoute({ ...route, id: undefined });
    setRoutes([...config.routes, copy]);
  };

  const toggleStart = async () => {
    if (running) {
      await stopMockServer();
      setRunning(false);
      toast.info('Mock server stopped');
      return;
    }
    if (!config.routes.some((r) => r.enabled)) {
      toast.warn('Add at least one route first');
      return;
    }
    try {
      const actualPort = await startMockServer(config);
      setRunning(true, actualPort);
      toast.success('Mock server running', `http://localhost:${actualPort}`);
    } catch (err) {
      toast.error('Could not start mock server', (err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <label className="flex items-center gap-1.5 text-[11.5px] text-dim">
          Port
          <input
            type="number"
            value={config.port || ''}
            onChange={(e) => setPort(Number(e.target.value) || 0)}
            placeholder="auto"
            disabled={running}
            className="h-7 w-20 rounded border border-line bg-surface px-2 font-mono text-[12px] focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </label>
        {running && port && (
          <Badge tone="ok" className="cursor-pointer" title="Click to copy">
            <span
              onClick={() => {
                navigator.clipboard.writeText(`http://localhost:${port}`);
                toast.success('Copied');
              }}
            >
              http://localhost:{port}
            </span>
          </Badge>
        )}
        <span className="flex-1" />
        <Button size="sm" onClick={addRoute}>
          <Plus size={12} /> Route
        </Button>
        <Button size="sm" variant={running ? 'danger' : 'primary'} onClick={toggleStart}>
          {running ? (
            <>
              <Square size={12} /> Stop
            </>
          ) : (
            <>
              <Play size={12} /> Start
            </>
          )}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {config.routes.length === 0 ? (
          <EmptyState
            icon={<Server size={22} />}
            title="No routes yet"
            detail="Add a route, give it a method, path and canned response, then start the server."
            action={
              <Button variant="primary" size="sm" onClick={addRoute}>
                <Plus size={12} /> Add a route
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col">
            {config.routes.map((route) => {
              const expanded = expandedId === route.id;
              return (
                <div key={route.id} className="border-b border-line">
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={route.enabled}
                      onChange={(e) => updateRoute(route.id, { enabled: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    <button
                      onClick={() => setExpandedId(expanded ? null : route.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <ChevronRight size={12} className={clsx('shrink-0 text-faint transition-transform', expanded && 'rotate-90')} />
                      <Select
                        value={route.method}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateRoute(route.id, { method: e.target.value });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-24 shrink-0"
                      >
                        {[...HTTP_METHODS].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                      <input
                        value={route.path}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateRoute(route.id, { path: e.target.value })}
                        placeholder="/users/:id"
                        className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-2 font-mono text-[12px] focus:border-accent focus:outline-none"
                      />
                      <input
                        type="number"
                        value={route.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateRoute(route.id, { status: Number(e.target.value) || 200 })}
                        className="h-7 w-16 shrink-0 rounded border border-line bg-surface px-2 font-mono text-[12px] focus:border-accent focus:outline-none"
                      />
                    </button>
                    <IconButton label="Duplicate" onClick={() => duplicateRoute(route.id)}>
                      <Copy size={12} />
                    </IconButton>
                    <IconButton label="Delete" tone="danger" onClick={() => deleteRoute(route.id)}>
                      <Trash2 size={12} />
                    </IconButton>
                  </div>

                  {expanded && (
                    <div className="flex flex-col gap-3 border-t border-line bg-surface-2 p-3">
                      <div className="flex items-center gap-2">
                        <label className="text-[11.5px] text-dim">Delay (ms)</label>
                        <input
                          type="number"
                          value={route.delayMs}
                          onChange={(e) => updateRoute(route.id, { delayMs: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-7 w-24 rounded border border-line bg-surface px-2 font-mono text-[12px] focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Headers</p>
                        <div className="flex flex-col gap-1">
                          {route.headers.map((h, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <input
                                value={h.key}
                                onChange={(e) => {
                                  const headers = [...route.headers];
                                  headers[i] = { ...headers[i], key: e.target.value };
                                  updateRoute(route.id, { headers });
                                }}
                                placeholder="Header"
                                className="h-6.5 w-40 rounded border border-line bg-surface px-1.5 font-mono text-[11.5px] focus:border-accent focus:outline-none"
                              />
                              <input
                                value={h.value}
                                onChange={(e) => {
                                  const headers = [...route.headers];
                                  headers[i] = { ...headers[i], value: e.target.value };
                                  updateRoute(route.id, { headers });
                                }}
                                placeholder="Value"
                                className="h-6.5 flex-1 rounded border border-line bg-surface px-1.5 font-mono text-[11.5px] focus:border-accent focus:outline-none"
                              />
                              <IconButton
                                label="Remove header"
                                onClick={() => updateRoute(route.id, { headers: route.headers.filter((_, j) => j !== i) })}
                              >
                                <Trash2 size={11} />
                              </IconButton>
                            </div>
                          ))}
                          <button
                            onClick={() => updateRoute(route.id, { headers: [...route.headers, { key: '', value: '' }] })}
                            className="w-fit text-[11px] text-accent hover:underline"
                          >
                            + Add header
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Body</p>
                        <div className="h-32 overflow-hidden rounded-md border border-line bg-surface">
                          <CodeEditor
                            value={route.body}
                            onChange={(body) => updateRoute(route.id, { body })}
                            language={languageFor(route.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? 'application/json')}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hits.length > 0 && (
          <div className="border-t border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Live requests</p>
              <button onClick={clearHits} className="text-[11px] text-faint hover:text-fg">
                Clear
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {hits.map((hit, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className="w-12 shrink-0 text-right text-[9.5px] font-bold" style={{ color: methodVar(hit.method) }}>
                    {hit.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-dim">{hit.path}</span>
                  <Badge tone={hit.matched ? 'ok' : 'warn'}>{hit.status}</Badge>
                  <span className="shrink-0 text-[10px] text-faint">{new Date(hit.at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
