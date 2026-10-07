import { config } from '../config';
import { isRecord, parseWorkOrder, RetrievalError, type WorkOrder } from './workOrders';
import { isAwareDate } from './dates';

export const editableFields = ['schedstart', 'schedfinish', 'assignedtechname', 'estdur', 'targstartdate', 'targcompdate'] as const;
export type EditableField = typeof editableFields[number];
export type Baseline = Record<EditableField, string | null> & { worktype: string };
export type Changes = Partial<Record<EditableField, string>> & { change_target?: boolean };
export type Scope = { connection_id: string; discipline: string };
export type Identity = Scope & { site_id: string; workorder_id: string };
export type Detail = { item: WorkOrder; baseline: Baseline; baseline_token: string; allowed_pics: string[]; pics_configured?: boolean };
export type Saved = { draft_id: string; version: number; state: 'draft'; updated_at?: string };
export type Restored = Detail & Saved & { changes: Changes; baseline_changed: boolean; changes_valid_now: boolean };
export type DraftSummary = { draft_id: string; version: number; wonum: string; site_id: string; item_count?: number; system_name?: string | null };
export type DraftNotice = Saved & { items: BatchRow[] | null };
export type BatchRow = Detail & { changes: Changes; baseline_changed?: boolean; changes_valid_now?: boolean };
export type BatchRestored = Saved & { items: BatchRow[] };
export type BatchIssue = { site_id: string; workorder_id: string; code: string };
export class BatchError extends RetrievalError {
  constructor(status: number, public readonly issues: BatchIssue[]) { super(status, 'Chưa lưu WO nào. Kiểm tra các dòng có lỗi.'); }
}

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
    if (path.startsWith('/draft-batches') && response.status === 409) {
      const raw: unknown = await response.json().catch(() => null);
      if (isRecord(raw) && isRecord(raw.detail) && Array.isArray(raw.detail.errors) &&
          raw.detail.errors.every((issue) => isRecord(issue) && typeof issue.site_id === 'string' &&
            typeof issue.workorder_id === 'string' && ['unavailable', 'baseline_changed', 'empty_changes', 'invalid_changes'].includes(String(issue.code)))) {
        throw new BatchError(409, raw.detail.errors as BatchIssue[]);
      }
    }
    const messages: Record<number, string> = {
      401: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.', 403: 'Phiên không hợp lệ. Hãy đăng nhập lại.',
      404: 'WO hoặc nháp không còn tồn tại hoặc không còn trong quyền truy cập.',
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
  if (!isRecord(raw) || typeof raw.draft_id !== 'string' || !Number.isInteger(raw.version) || Number(raw.version) < 1 || raw.state !== 'draft' ||
    (raw.updated_at !== undefined && (typeof raw.updated_at !== 'string' || !isAwareDate(raw.updated_at)))) return invalid();
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

export async function listPlannedWorkOrders(scope: Scope, offset: number, signal: AbortSignal): Promise<{ items: WorkOrder[]; next_offset: number | null }> {
  const raw = await call(`/drafts?${new URLSearchParams({ ...scope, offset: String(offset), include_items: 'true' })}`, signal);
  if (!isRecord(raw) || raw.connection_id !== scope.connection_id || raw.discipline !== scope.discipline || !Array.isArray(raw.items) || raw.items.length > 20 ||
    !(raw.next_offset === null || (Number.isInteger(raw.next_offset) && Number(raw.next_offset) > offset))) return invalid();
  const rows = new Map<string, WorkOrder>();
  for (const draft of raw.items) {
    if (!isRecord(draft) || typeof draft.draft_id !== 'string' || !Number.isInteger(draft.version) || Number(draft.version) < 1 ||
      typeof draft.updated_at !== 'string' || !isAwareDate(draft.updated_at) || !Array.isArray(draft.items) || !draft.items.length || draft.items.length > 200) return invalid();
    const keys = new Set<string>();
    for (const member of draft.items) {
      if (!isRecord(member) || member.discipline !== scope.discipline || typeof member.baseline_changed !== 'boolean' ||
        !isRecord(member.changes) || !Object.entries(member.changes).every(([key, value]) =>
          key === 'change_target' ? typeof value === 'boolean' : editableFields.includes(key as EditableField) && typeof value === 'string')) return invalid();
      const row = parseWorkOrder(member.item, scope.discipline);
      if (member.site_id !== row.siteid || member.workorder_id !== row.workorderid) return invalid();
      const key = JSON.stringify([row.siteid, row.workorderid]);
      if (keys.has(key)) return invalid();
      keys.add(key);
      const previous = rows.get(key);
      if (previous?.drafts?.some((item) => item.draft_id === draft.draft_id)) return invalid();
      rows.set(key, { ...row, drafts: [...previous?.drafts ?? [], { draft_id: draft.draft_id, version: Number(draft.version),
        is_batch: draft.items.length > 1, updated_at: draft.updated_at, baseline_changed: member.baseline_changed, changes: member.changes as Changes }] });
    }
  }
  return { items: [...rows.values()], next_offset: raw.next_offset as number | null };
}
export async function deleteDraft(draft: Saved, signal: AbortSignal): Promise<void> {
  await call(`/drafts/${encodeURIComponent(draft.draft_id)}?version=${draft.version}`, signal, 'DELETE');
}

export async function prepareBatch(scope: Scope, keys: { site_id: string; workorder_id: string }[], signal: AbortSignal): Promise<Detail[]> {
  const raw = await call('/draft-batches/prepare', signal, 'POST', { ...scope, items: keys });
  if (!isRecord(raw) || raw.connection_id !== scope.connection_id || raw.discipline !== scope.discipline ||
      !Array.isArray(raw.items) || raw.items.length !== keys.length) return invalid();
  return raw.items.map((item, index) => {
    const parsed = detail(item, scope);
    if (parsed.item.siteid !== keys[index].site_id || parsed.item.workorderid !== keys[index].workorder_id) return invalid();
    return parsed;
  });
}

export async function saveBatch(scope: Scope, items: BatchRow[], requestId: string, existing: Saved | null, signal: AbortSignal): Promise<Saved> {
  return saved(await call(existing ? `/draft-batches/${encodeURIComponent(existing.draft_id)}` : '/draft-batches', signal,
    existing ? 'PUT' : 'POST', { ...scope, request_id: requestId, ...(existing ? { version: existing.version } : {}),
      items: items.map((row) => ({ site_id: row.item.siteid, workorder_id: row.item.workorderid,
        baseline_token: row.baseline_token, changes: row.changes })) }));
}

export async function openBatch(id: string, scope: Scope, signal: AbortSignal): Promise<BatchRestored> {
  const raw = await call(`/draft-batches/${encodeURIComponent(id)}`, signal);
  const result = saved(raw);
  if (!isRecord(raw) || result.draft_id !== id || raw.connection_id !== scope.connection_id ||
      !Array.isArray(raw.items) || !raw.items.length || raw.items.length > 200) return invalid();
  const keys = new Set<string>();
  const items = raw.items.map((item) => {
    if (!isRecord(item) || item.discipline !== scope.discipline || typeof item.baseline_changed !== 'boolean' ||
        typeof item.changes_valid_now !== 'boolean' || !isRecord(item.changes) ||
        !Object.entries(item.changes).every(([key, value]) => key === 'change_target' ? typeof value === 'boolean' :
          editableFields.includes(key as EditableField) && typeof value === 'string')) return invalid();
    const parsed = detail(item, scope);
    if (parsed.item.siteid !== item.site_id || parsed.item.workorderid !== item.workorder_id) return invalid();
    const key = JSON.stringify([item.site_id, item.workorder_id]);
    if (keys.has(key)) return invalid();
    keys.add(key);
    return { ...parsed, changes: item.changes as Changes, baseline_changed: item.baseline_changed,
      changes_valid_now: item.changes_valid_now };
  });
  return { ...result, items };
}
