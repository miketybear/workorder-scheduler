import { config } from '../config';
import { isRecord, parseWorkOrder, RetrievalError, type WorkOrder } from './workOrders';

export const editableFields = ['schedstart', 'schedfinish', 'assignedtechname', 'estdur', 'targstartdate', 'targcompdate'] as const;
export type EditableField = typeof editableFields[number];
export type Baseline = Record<EditableField, string | null> & { worktype: string };
export type Changes = Partial<Record<EditableField, string>> & { change_target?: boolean };
export type Scope = { connection_id: string; discipline: string };
export type Identity = Scope & { site_id: string; workorder_id: string };
export type Detail = { item: WorkOrder; baseline: Baseline; baseline_token: string; allowed_pics: string[]; pics_configured?: boolean };
export type Saved = { draft_id: string; version: number; state: 'draft' };
export type Restored = Detail & Saved & { changes: Changes; baseline_changed: boolean; changes_valid_now: boolean };
export type DraftSummary = { draft_id: string; version: number; wonum: string; site_id: string };

async function call(path: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
    if (!csrf) throw new RetrievalError(401, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.');
    headers['X-CSRF-Token'] = csrf;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${config.apiBase}${path}`, { signal, method, headers,
    body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.', 403: 'Phiên không hợp lệ. Hãy đăng nhập lại.',
      404: 'WO hoặc nháp không còn trong quyền truy cập.',
      409: 'WO hoặc nháp đã thay đổi. Mở lại để đối chiếu trước khi lưu.',
      422: 'Thay đổi không hợp lệ. Kiểm tra ngày, PIC và duration.',
    };
    throw new RetrievalError(response.status, messages[response.status] ?? 'Không hoàn tất yêu cầu. Nội dung sửa vẫn được giữ; có thể thử lại.');
  }
  return response.status === 204 ? null : response.json();
}
function invalid(): never { throw new Error('Phản hồi nháp không hợp lệ.'); }
function baseline(raw: unknown): Baseline {
  if (!isRecord(raw) || typeof raw.worktype !== 'string' ||
    !editableFields.every((key) => raw[key] === null || typeof raw[key] === 'string')) return invalid();
  return raw as Baseline;
}
function detail(raw: unknown, scope: Scope): Detail {
  if (!isRecord(raw) || typeof raw.baseline_token !== 'string' || !/^[a-f0-9]{64}$/.test(raw.baseline_token) ||
      !Array.isArray(raw.allowed_pics) || !raw.allowed_pics.every((pic) => typeof pic === 'string') ||
      (raw.pics_configured !== undefined && typeof raw.pics_configured !== 'boolean')) return invalid();
  return { item: parseWorkOrder(raw.item, scope.discipline), baseline: baseline(raw.baseline),
    baseline_token: raw.baseline_token, allowed_pics: raw.allowed_pics, pics_configured: raw.pics_configured as boolean | undefined };
}
function saved(raw: unknown): Saved {
  if (!isRecord(raw) || typeof raw.draft_id !== 'string' || !Number.isInteger(raw.version) || Number(raw.version) < 1 || raw.state !== 'draft') return invalid();
  return raw as Saved;
}
export async function getDetail(key: Identity, signal: AbortSignal): Promise<Detail> {
  const raw = await call(`/work-orders/detail?${new URLSearchParams(key)}`, signal);
  if (!isRecord(raw) || raw.connection_id !== key.connection_id) return invalid();
  const result = detail(raw, key);
  if (result.item.siteid !== key.site_id || result.item.workorderid !== key.workorder_id) return invalid();
  return result;
}
export async function saveDraft(key: Identity, changes: Changes, token: string, requestId: string,
  existing: Saved | null, signal: AbortSignal): Promise<Saved> {
  return saved(await call(existing ? `/drafts/${encodeURIComponent(existing.draft_id)}` : '/drafts', signal,
    existing ? 'PUT' : 'POST', { ...key, changes, baseline_token: token, request_id: requestId,
      ...(existing ? { version: existing.version } : {}) }));
}
export async function openDraft(id: string, scope: Scope, signal: AbortSignal): Promise<Restored> {
  const raw = await call(`/drafts/${encodeURIComponent(id)}`, signal);
  const result = saved(raw);
  if (!isRecord(raw) || result.draft_id !== id || raw.connection_id !== scope.connection_id ||
    !Array.isArray(raw.items) || raw.items.length !== 1 || !isRecord(raw.items[0])) return invalid();
  const item = raw.items[0];
  if (item.discipline !== scope.discipline || typeof item.baseline_changed !== 'boolean' || typeof item.changes_valid_now !== 'boolean' ||
      !isRecord(item.changes) || !Object.entries(item.changes).every(([key, value]) =>
        key === 'change_target' ? typeof value === 'boolean' : editableFields.includes(key as EditableField) && typeof value === 'string')) return invalid();
  const parsed = detail(item, scope);
  if (parsed.item.siteid !== item.site_id || parsed.item.workorderid !== item.workorder_id) return invalid();
  return { ...parsed, ...result, changes: item.changes as Changes,
    baseline_changed: item.baseline_changed, changes_valid_now: item.changes_valid_now };
}
export async function listDrafts(scope: Scope, offset: number, signal: AbortSignal): Promise<{ items: DraftSummary[]; next_offset: number | null }> {
  const raw = await call(`/drafts?${new URLSearchParams({ ...scope, offset: String(offset) })}`, signal);
  if (!isRecord(raw) || !Array.isArray(raw.items) || !(raw.next_offset === null || Number.isInteger(raw.next_offset)) ||
      !raw.items.every((item) => isRecord(item) && typeof item.draft_id === 'string' && Number.isInteger(item.version) &&
        typeof item.wonum === 'string' && typeof item.site_id === 'string')) return invalid();
  return raw as { items: DraftSummary[]; next_offset: number | null };
}
export async function deleteDraft(draft: Saved, signal: AbortSignal): Promise<void> {
  await call(`/drafts/${encodeURIComponent(draft.draft_id)}?version=${draft.version}`, signal, 'DELETE');
}
