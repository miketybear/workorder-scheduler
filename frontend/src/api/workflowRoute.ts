import { config } from '../config';
import { isRecord } from './workOrders';

/** Route WO to its Tech PIC through the BD_WO workflow (contract: docs/workflow-route-api.md). */
export type RouteScope = { connection_id: string; discipline: string };
export type RouteTarget = { site_id: string; workorder_id: string };
export type RouteStatus = { enabled: boolean; can_route: boolean; personid: string | null; session: { active: boolean; expires_at: string | null } };
export type SupervisorPlan = { current: string | null; will_set: string | null };
export type PreviewItem = RouteTarget & { wonum: string | null; ready: boolean; code: string; node_id: number | null;
  wfassignment_id: string | null; assigned_to: string | null; supervisor: SupervisorPlan | null };
export type RoutePreview = { contract: { ok: boolean; problem: string | null }; items: PreviewItem[] };
export type RouteItemState = 'confirmed' | 'rejected' | 'failed' | 'stranded' | 'unknown' | 'pending' | 'sending' | 'not_attempted';
export type RouteResultItem = RouteTarget & { wonum: string | null; state: RouteItemState; code: string | null;
  wfassignment_id_after: string | null; assigned_to: string | null };
export type RouteResult = { request_id: string; complete: boolean; counts: Record<string, number>; items: RouteResultItem[] };

/** An error answered by the route API; `code` is the stable machine code when the server sent one. */
export class RouteApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | null, message: string,
    public readonly extra: { remaining_attempts?: number; retry_after_seconds?: number; problem?: string } = {}) { super(message); }
}

const ITEM_STATES: readonly string[] = ['confirmed', 'rejected', 'failed', 'stranded', 'unknown', 'pending', 'sending', 'not_attempted'];
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;

function csrfToken(): string {
  const token = document.cookie.split('; ').find((part) => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
  if (!token) throw new RouteApiError(401, null, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.');
  return token;
}

const MESSAGES: Record<number, string> = {
  401: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Phiên không hợp lệ. Hãy tải lại trang.',
  404: 'Không còn quyền với phạm vi này.',
  502: 'Không đọc được Maximo. Thử lại sau.',
};

async function call(path: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') { headers['X-CSRF-Token'] = csrfToken(); headers['Content-Type'] = 'application/json'; }
  const response = await fetch(`${config.apiBase}${path}`, { signal, method, headers,
    body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 204) return null;
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord(raw) ? raw.detail : null;
    const code = isRecord(detail) ? text(detail.code) : null;
    const extra = isRecord(detail) ? {
      ...(typeof detail.remaining_attempts === 'number' ? { remaining_attempts: detail.remaining_attempts } : {}),
      ...(typeof detail.retry_after_seconds === 'number' ? { retry_after_seconds: detail.retry_after_seconds } : {}),
      ...(typeof detail.problem === 'string' ? { problem: detail.problem } : {}),
    } : {};
    throw new RouteApiError(response.status, code, MESSAGES[response.status] ?? 'Không thực hiện được. Hãy thử lại.', extra);
  }
  return raw;
}

const query = (scope: RouteScope) => new URLSearchParams({ connection_id: scope.connection_id, discipline: scope.discipline });

function parseSession(value: unknown): RouteStatus['session'] {
  if (!isRecord(value) || typeof value.active !== 'boolean') throw new Error('Phản hồi route không hợp lệ.');
  return { active: value.active, expires_at: text(value.expires_at) };
}

export function parseStatus(raw: unknown): RouteStatus {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean' || typeof raw.can_route !== 'boolean') throw new Error('Phản hồi route không hợp lệ.');
  return { enabled: raw.enabled, can_route: raw.can_route, personid: text(raw.personid), session: parseSession(raw.session) };
}

function parseTarget(raw: Record<string, unknown>): RouteTarget {
  if (typeof raw.site_id !== 'string' || typeof raw.workorder_id !== 'string') throw new Error('Phản hồi route không hợp lệ.');
  return { site_id: raw.site_id, workorder_id: raw.workorder_id };
}

export function parsePreview(raw: unknown): RoutePreview {
  if (!isRecord(raw) || !isRecord(raw.contract) || typeof raw.contract.ok !== 'boolean' || !Array.isArray(raw.items)) throw new Error('Phản hồi route không hợp lệ.');
  return {
    contract: { ok: raw.contract.ok, problem: text(raw.contract.problem) },
    items: raw.items.map((item: unknown): PreviewItem => {
      if (!isRecord(item) || typeof item.ready !== 'boolean' || typeof item.code !== 'string') throw new Error('Phản hồi route không hợp lệ.');
      const supervisor = isRecord(item.supervisor) ? { current: text(item.supervisor.current), will_set: text(item.supervisor.will_set) } : null;
      return { ...parseTarget(item), wonum: text(item.wonum), ready: item.ready, code: item.code,
        node_id: typeof item.node_id === 'number' ? item.node_id : null, wfassignment_id: text(item.wfassignment_id),
        assigned_to: text(item.assigned_to), supervisor };
    }),
  };
}

export function parseResult(raw: unknown): RouteResult {
  if (!isRecord(raw) || typeof raw.request_id !== 'string' || typeof raw.complete !== 'boolean' || !Array.isArray(raw.items)) throw new Error('Phản hồi route không hợp lệ.');
  const counts: Record<string, number> = {};
  if (isRecord(raw.counts)) for (const [key, value] of Object.entries(raw.counts)) if (typeof value === 'number') counts[key] = value;
  return {
    request_id: raw.request_id, complete: raw.complete, counts,
    items: raw.items.map((item: unknown): RouteResultItem => {
      if (!isRecord(item) || typeof item.state !== 'string' || !ITEM_STATES.includes(item.state)) throw new Error('Phản hồi route không hợp lệ.');
      return { ...parseTarget(item), wonum: text(item.wonum), state: item.state as RouteItemState, code: text(item.code),
        wfassignment_id_after: text(item.wfassignment_id_after), assigned_to: text(item.assigned_to) };
    }),
  };
}

export async function getRouteStatus(scope: RouteScope, signal: AbortSignal): Promise<RouteStatus> {
  return parseStatus(await call(`/workflow/route/status?${query(scope)}`, signal));
}

/** The password is sent once, here; the caller must clear it from the form right after this returns or throws. */
export async function createRouteSession(scope: RouteScope, username: string, password: string, signal: AbortSignal): Promise<RouteStatus['session']> {
  const raw = await call('/workflow/route/session', signal, 'POST', { ...scope, username, password });
  if (!isRecord(raw)) throw new Error('Phản hồi route không hợp lệ.');
  return parseSession(raw.session);
}

export async function deleteRouteSession(scope: RouteScope, signal: AbortSignal): Promise<void> {
  await call(`/workflow/route/session?${query(scope)}`, signal, 'DELETE');
}

export async function previewRoute(scope: RouteScope, items: RouteTarget[], signal: AbortSignal): Promise<RoutePreview> {
  return parsePreview(await call('/workflow/route/preview', signal, 'POST', { ...scope, items }));
}

export async function routeWorkOrders(scope: RouteScope, requestId: string, items: RouteTarget[], signal: AbortSignal): Promise<RouteResult> {
  return parseResult(await call('/workflow/route', signal, 'POST', { ...scope, request_id: requestId, items }));
}

export async function getRouteSubmission(requestId: string, signal: AbortSignal): Promise<RouteResult> {
  return parseResult(await call(`/workflow/route-submissions/${encodeURIComponent(requestId)}`, signal));
}

/** Reads Maximo only; never sends a write again. */
export async function reconcileRoute(requestId: string, signal: AbortSignal): Promise<RouteResult> {
  return parseResult(await call(`/workflow/route-submissions/${encodeURIComponent(requestId)}/reconcile`, signal, 'POST', {}));
}
