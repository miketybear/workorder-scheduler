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
export type UploadPreviewWarning = 'pm_duration_recalculation';
export type UploadPreviewItem = { site_id: string; workorder_id: string; code: 'ready' | 'conflict' | 'invalid_changes' | 'empty_changes'; before: Partial<Record<EditableField, string | null>>; changes: Partial<Record<EditableField, string>>; warnings: UploadPreviewWarning[] };
export type UploadPreview = { draft_id: string; version: number; preview_hash: string; send_enabled: boolean; gate: 'write_contract_unverified' | null; items: UploadPreviewItem[] };
export type UploadState = 'pending' | 'sending' | 'confirmed' | 'failed' | 'conflict' | 'unknown';
export type DurationResult = { code: 'pm_duration_recalculated' | 'pm_duration_mismatch'; expected: string | null; actual: string | null };
export type UploadStatusItem = { item_id: string; connection_id: string; site_id: string; workorder_id: string; state: UploadState; updated_at: string;
  source: { draft_id: string; draft_version: number; member_id: string } | null; duration_result: DurationResult | null;
  restore_source: { before: Baseline } | null };
export type UploadStatus = { batch_id: string; counts: Partial<Record<UploadState, number>>; items: UploadStatusItem[]; source_finalized: boolean };
export type UploadRecoveryEntry = { request_id: string; draft_id: string; version: number; preview_hash: string;
  connection_id: string; discipline: string; items: { site_id: string; workorder_id: string }[] };
export class UploadRequestNotFoundError extends Error {}
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
    if (path.startsWith('/uploads/by-request/') && response.status === 404) {
      const raw: unknown = await response.json().catch(() => null);
      if (isRecord(raw) && isRecord(raw.detail) && raw.detail.code === 'receipt_not_found') {
        throw new UploadRequestNotFoundError('Chưa tìm thấy kết quả yêu cầu upload. Có thể kiểm tra lại sau.');
      }
    }
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

export async function previewUpload(draft: Saved, items: { site_id: string; workorder_id: string }[], signal: AbortSignal): Promise<UploadPreview> {
  const raw = await call(`/drafts/${encodeURIComponent(draft.draft_id)}/upload-preview`, signal, 'POST', { version: draft.version, items });
  const validValues = (value: unknown) => isRecord(value) && Object.entries(value).every(([field, item]) => {
    if (!editableFields.includes(field as EditableField) || !(item === null || typeof item === 'string')) return false;
    if (item === null || field === 'assignedtechname') return true;
    if (field === 'estdur') return /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(item) && Number.isFinite(Number(item)) && Number(item) >= 0;
    return isAwareDate(item);
  });
  if (!isRecord(raw) || raw.draft_id !== draft.draft_id || raw.version !== draft.version ||
      typeof raw.preview_hash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.preview_hash) ||
      typeof raw.send_enabled !== 'boolean' || !(raw.gate === null || raw.gate === 'write_contract_unverified') ||
      (raw.send_enabled !== (raw.gate === null)) || !Array.isArray(raw.items) || raw.items.length !== items.length) return invalid();
  const expected = new Set(items.map(({ site_id, workorder_id }) => JSON.stringify([site_id, workorder_id])));
  const seen = new Set<string>();
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.site_id !== 'string' || typeof item.workorder_id !== 'string' ||
        !['ready', 'conflict', 'invalid_changes', 'empty_changes'].includes(String(item.code)) ||
        !Array.isArray(item.warnings) || !item.warnings.every((warning) => warning === 'pm_duration_recalculation') ||
        !validValues(item.before) || !isRecord(item.changes) ||
        !Object.entries(item.changes).every(([field, value]) => {
          if (!editableFields.includes(field as EditableField) || typeof value !== 'string') return false;
          if (field === 'assignedtechname') return true;
          if (field === 'estdur') return /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
          return isAwareDate(value);
        })) return invalid();
    const key = JSON.stringify([item.site_id, item.workorder_id]);
    const before = item.before as Record<string, unknown>;
    if (!expected.has(key) || seen.has(key) || Object.keys(before).length !== Object.keys(item.changes).length ||
        Object.keys(item.changes).some((field) => !Object.hasOwn(before, field)) ||
        (item.code === 'ready' && Object.keys(item.changes).length === 0) ||
        (item.warnings.includes('pm_duration_recalculation') && item.code !== 'ready')) return invalid();
    seen.add(key);
  }
  return raw as UploadPreview;
}

export async function submitUpload(draft: Saved, requestId: string, preview: UploadPreview, connectionId: string, signal: AbortSignal): Promise<UploadStatus> {
  if (!preview.send_enabled || preview.gate !== null || preview.draft_id !== draft.draft_id || preview.version !== draft.version ||
      preview.items.some((item) => item.code !== 'ready')) return invalid();
  return parseUploadStatus(await call(`/drafts/${encodeURIComponent(draft.draft_id)}/uploads`, signal, 'POST', {
    version: draft.version, request_id: requestId, preview_hash: preview.preview_hash,
    items: preview.items.map(({ site_id, workorder_id }) => ({ site_id, workorder_id })),
  }), { batchId: null, draft, connectionId, items: preview.items });
}

export async function getUploadStatus(batchId: string, draft: Saved, connectionId: string,
  items: Pick<UploadPreviewItem, 'site_id' | 'workorder_id'>[], signal: AbortSignal): Promise<UploadStatus> {
  return parseUploadStatus(await call(`/uploads/${encodeURIComponent(batchId)}`, signal), { batchId, draft, connectionId, items });
}

export async function lookupUploadRequest(entry: UploadRecoveryEntry, signal: AbortSignal): Promise<UploadStatus> {
  const draft: Saved = { draft_id: entry.draft_id, version: entry.version, state: 'draft' };
  return parseUploadStatus(await call(`/uploads/by-request/${encodeURIComponent(entry.request_id)}`, signal), {
    batchId: null, draft, connectionId: entry.connection_id, items: entry.items,
  });
}

export async function continueUpload(batchId: string, draft: Saved, connectionId: string,
  items: Pick<UploadPreviewItem, 'site_id' | 'workorder_id'>[], signal: AbortSignal): Promise<UploadStatus> {
  return parseUploadStatus(await call(`/uploads/${encodeURIComponent(batchId)}/continue`, signal, 'POST', {}), { batchId, draft, connectionId, items });
}

export async function reconcileUpload(batchId: string, draft: Saved, connectionId: string,
  items: Pick<UploadPreviewItem, 'site_id' | 'workorder_id'>[], signal: AbortSignal): Promise<UploadStatus> {
  return parseUploadStatus(await call(`/uploads/${encodeURIComponent(batchId)}/reconcile`, signal, 'POST', {}), { batchId, draft, connectionId, items });
}

function parseUploadStatus(raw: unknown, expected: { batchId: string | null; draft: Saved; connectionId: string;
  items: Pick<UploadPreviewItem, 'site_id' | 'workorder_id'>[] }): UploadStatus {
  const states: UploadState[] = ['pending', 'sending', 'confirmed', 'failed', 'conflict', 'unknown'];
  if (!isRecord(raw) || typeof raw.batch_id !== 'string' || (expected.batchId && raw.batch_id !== expected.batchId) ||
      typeof raw.source_finalized !== 'boolean' || !isRecord(raw.counts) || !Array.isArray(raw.items) || raw.items.length !== expected.items.length) return invalid();
  const counts: Partial<Record<UploadState, number>> = {};
  for (const [key, value] of Object.entries(raw.counts)) {
    if (!states.includes(key as UploadState) || !Number.isInteger(value) || Number(value) < 0) return invalid();
    counts[key as UploadState] = Number(value);
  }
  const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
  if (total !== raw.items.length) return invalid();
  const selected = new Map(expected.items.map((item) => [JSON.stringify([item.site_id, item.workorder_id]), item]));
  const seen = new Set<string>();
  const parsed: UploadStatusItem[] = [];
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.item_id !== 'string' || typeof item.connection_id !== 'string' ||
        typeof item.site_id !== 'string' || typeof item.workorder_id !== 'string' || !states.includes(item.state as UploadState) ||
        typeof item.updated_at !== 'string' || !isAwareDate(item.updated_at)) return invalid();
    const key = JSON.stringify([item.site_id, item.workorder_id]);
    const source = item.source;
    let restoreSource: UploadStatusItem['restore_source'] = null;
    if (item.restore_source !== null) {
      if (!isRecord(item.restore_source) || !isRecord(item.restore_source.before)) return invalid();
      const original = item.restore_source.before;
      if (original.worktype !== 'PM' || !editableFields.every((field) => original[field] === null || typeof original[field] === 'string') ||
          !['schedstart', 'schedfinish'].every((field) => original[field] === null || (typeof original[field] === 'string' && isAwareDate(original[field]))) ||
          (original.estdur !== null && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(original.estdur)) ||
            !Number.isFinite(Number(original.estdur)) || Number(original.estdur) < 0 || Number(original.estdur) > 100000)) ||
          !['targstartdate', 'targcompdate'].every((field) => original[field] === null || (typeof original[field] === 'string' && isAwareDate(original[field]))) ||
          !(original.assignedtechname === null || typeof original.assignedtechname === 'string') ||
          item.state !== 'confirmed') return invalid();
      restoreSource = { before: original as Baseline };
    } else if (!('restore_source' in item)) return invalid();
    let durationResult: DurationResult | null = null;
    if (item.duration_result !== null) {
      const result = item.duration_result;
      const validDuration = (value: unknown) => value === null || (typeof value === 'string' && /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100000);
      if (!isRecord(result) || !['pm_duration_recalculated', 'pm_duration_mismatch'].includes(String(result.code)) ||
          !validDuration(result.expected) || !validDuration(result.actual) ||
          (result.code === 'pm_duration_recalculated' && (item.state !== 'confirmed' || result.actual === null)) ||
          (result.code === 'pm_duration_mismatch' && item.state !== 'unknown')) return invalid();
      durationResult = { code: result.code as DurationResult['code'], expected: result.expected as string | null, actual: result.actual as string | null };
    }
    if (!selected.has(key) || seen.has(key) || item.connection_id !== expected.connectionId || !isRecord(source) ||
        source.draft_id !== expected.draft.draft_id || source.draft_version !== expected.draft.version ||
        typeof source.member_id !== 'string') return invalid();
    seen.add(key);
    parsed.push({ item_id: item.item_id, connection_id: item.connection_id, site_id: item.site_id, workorder_id: item.workorder_id,
      state: item.state as UploadState, updated_at: item.updated_at, source: { draft_id: source.draft_id,
        draft_version: Number(source.draft_version), member_id: source.member_id }, duration_result: durationResult, restore_source: restoreSource });
  }
  const actualCounts: Partial<Record<UploadState, number>> = {};
  for (const item of parsed) actualCounts[item.state] = (actualCounts[item.state] ?? 0) + 1;
  if (states.some((state) => (counts[state] ?? 0) !== (actualCounts[state] ?? 0))) return invalid();
  if (raw.source_finalized && (parsed.some((item) => item.state !== 'confirmed') || parsed.length !== expected.items.length)) return invalid();
  return { batch_id: raw.batch_id, counts, items: parsed, source_finalized: raw.source_finalized };
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
