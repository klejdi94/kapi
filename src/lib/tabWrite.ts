import { useSession } from '@/store/session';
import { useWorkspaces } from '@/store/workspaces';
import type { GrpcRequestDef, RequestDef, WebSocketRequestDef, MqttRequestDef } from '@/types';

/**
 * Writes a tab's request draft and, when the tab is backed by a saved node,
 * autosaves straight back into its collection in the same step — the single
 * place that implements "every change saves itself" so the request editor,
 * example-saving, AI-generated scripts and anything else that can produce a
 * full request for the open tab all get it for free, consistently.
 */
export function writeTabRequest(tabId: string, request: RequestDef) {
  const session = useSession.getState();
  const tab = session.tabs.find((t) => t.id === tabId);
  session.updateTabRequest(tabId, request);
  if (tab?.nodeId && tab.collectionId) {
    useWorkspaces.getState().updateRequest(tab.collectionId, tab.nodeId, request);
    session.patchTab(tabId, { dirty: false });
  }
}

export function writeTabWs(tabId: string, ws: WebSocketRequestDef) {
  const session = useSession.getState();
  const tab = session.tabs.find((t) => t.id === tabId);
  session.updateTabWs(tabId, ws);
  if (tab?.nodeId && tab.collectionId) {
    useWorkspaces.getState().updateWebSocketRequest(tab.collectionId, tab.nodeId, ws);
    session.patchTab(tabId, { dirty: false });
  }
}

export function writeTabGrpc(tabId: string, grpc: GrpcRequestDef) {
  const session = useSession.getState();
  const tab = session.tabs.find((t) => t.id === tabId);
  session.patchTab(tabId, { grpc, dirty: tab?.nodeId ? true : tab?.dirty ?? false });
  if (tab?.nodeId && tab.collectionId) {
    useWorkspaces.getState().updateGrpcRequest(tab.collectionId, tab.nodeId, grpc);
    session.patchTab(tabId, { dirty: false });
  }
}

export function writeTabMqtt(tabId: string, mqtt: MqttRequestDef) {
  const session = useSession.getState();
  const tab = session.tabs.find((t) => t.id === tabId);
  session.patchTab(tabId, { mqtt, dirty: tab?.nodeId ? true : tab?.dirty ?? false });
  if (tab?.nodeId && tab.collectionId) {
    useWorkspaces.getState().updateMqttRequest(tab.collectionId, tab.nodeId, mqtt);
    session.patchTab(tabId, { dirty: false });
  }
}
