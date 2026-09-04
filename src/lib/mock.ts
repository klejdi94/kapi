import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MockServerConfig } from '@/types';
import { isDesktop } from './transport';

export interface MockHit {
  method: string;
  path: string;
  status: number;
  matched: boolean;
  at: number;
}

export function mockAvailable(): boolean {
  return isDesktop();
}

/** Returns the actual bound port (useful when `config.port` was 0). */
export async function startMockServer(config: MockServerConfig): Promise<number> {
  return invoke<number>('kapi_mock_start', {
    config: {
      port: config.port,
      routes: config.routes
        .filter((r) => r.enabled)
        .map((r) => ({
          method: r.method,
          path: r.path,
          status: r.status,
          headers: r.headers,
          body: r.body,
          delay_ms: r.delayMs,
        })),
    },
  });
}

export async function stopMockServer(): Promise<void> {
  await invoke('kapi_mock_stop');
}

export async function isMockServerRunning(): Promise<boolean> {
  return invoke<boolean>('kapi_mock_is_running');
}

export function onMockHit(handler: (hit: MockHit) => void): Promise<UnlistenFn> {
  return listen<MockHit>('kapi://mock-hit', (event) => handler(event.payload));
}
