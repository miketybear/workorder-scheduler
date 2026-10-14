import { config } from '../config';
import { RotaImportError } from './rotaImports';

export interface ActivationDayValue { code: string; capacity_hours: number | null; craft: string | null; role: string | null }
export interface ActivationDayChange { date: string; before: ActivationDayValue | null; after: ActivationDayValue | null }
export interface ActivationPersonChange {
  person_key: string; name: string; change_type: 'added' | 'removed' | 'changed';
  before_crafts: string[]; after_crafts: string[]; before_roles: string[]; after_roles: string[];
  before_hours: number; after_hours: number; changed_days: number;
  day_changes: ActivationDayChange[]; day_changes_truncated: boolean;
}
export interface RotaActivationPreview {
  import_id: string; pool_id: string; import_version: number; pool_version: number; policy_version: string;
  coverage_from: string | null; coverage_before: string | null; can_activate: boolean; blocking_reasons: string[];
  diff: { added_people: number; removed_people: number; changed_people: number; changed_days: number; before_hours: number; after_hours: number };
  changes: ActivationPersonChange[]; activation_receipt: RotaActivationReceipt | null;
}
export interface RotaActivationReceipt {
  id: string; pool_id: string; import_id: string; import_version: number; pool_version: number;
  coverage_from: string; coverage_before: string; activated_at: string; person_count: number; day_count: number; total_hours: number;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown) => typeof value === 'string';
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const strings = (value: unknown) => Array.isArray(value) && value.every(str);
function parseDayValue(value: unknown): ActivationDayValue | null {
  if (value === null) return null;
  if (!record(value) || !str(value.code) || !(value.capacity_hours === null || num(value.capacity_hours)) ||
    !(value.craft === null || str(value.craft)) || !(value.role === null || str(value.role))) throw new Error('Chi tiết ngày thay đổi không hợp lệ.');
  return value as unknown as ActivationDayValue;
}
function parseActivationPreview(value: unknown): RotaActivationPreview {
  if (!record(value) || !str(value.import_id) || !str(value.pool_id) || !Number.isInteger(value.import_version) ||
    !Number.isInteger(value.pool_version) || Number(value.pool_version) < 0 || !str(value.policy_version) ||
    !(value.coverage_from === null || str(value.coverage_from)) || !(value.coverage_before === null || str(value.coverage_before)) ||
    typeof value.can_activate !== 'boolean' || !strings(value.blocking_reasons) || !record(value.diff) ||
    !num(value.diff.before_hours) || !num(value.diff.after_hours) || !Array.isArray(value.changes) ||
    !(value.activation_receipt === null || record(value.activation_receipt))) throw new Error('Preview kích hoạt rota không hợp lệ.');
  const diff = value.diff as Record<string, unknown>;
  if (!['added_people','removed_people','changed_people','changed_days'].every(key => Number.isInteger(diff[key]) && Number(diff[key]) >= 0)) throw new Error('Preview kích hoạt rota không hợp lệ.');
  const changes = value.changes.map(item => {
    if (!record(item) || !str(item.person_key) || !str(item.name) || !['added','removed','changed'].includes(String(item.change_type)) ||
      !strings(item.before_crafts) || !strings(item.after_crafts) || !strings(item.before_roles) || !strings(item.after_roles) ||
      !num(item.before_hours) || !num(item.after_hours) || !num(item.changed_days) || !Number.isInteger(item.changed_days) || Number(item.changed_days) < 0 ||
      typeof item.day_changes_truncated !== 'boolean' || !Array.isArray(item.day_changes)) throw new Error('Chi tiết người thay đổi không hợp lệ.');
    const dayChanges = item.day_changes.map(day => {
      if (!record(day) || !str(day.date)) throw new Error('Ngày thay đổi không hợp lệ.');
      return { date: day.date, before: parseDayValue(day.before), after: parseDayValue(day.after) };
    });
    return { ...item, day_changes: dayChanges } as ActivationPersonChange;
  });
  return { ...value, changes, activation_receipt: value.activation_receipt === null ? null : parseReceipt(value.activation_receipt) } as unknown as RotaActivationPreview;
}
function parseReceipt(value: unknown): RotaActivationReceipt {
  if (!record(value) || !['id','pool_id','import_id','coverage_from','coverage_before','activated_at'].every(key => str(value[key])) ||
    !['import_version','pool_version','person_count','day_count'].every(key => Number.isInteger(value[key]) && Number(value[key]) >= 0) || !num(value.total_hours)) {
    throw new Error('Biên nhận kích hoạt rota không hợp lệ.');
  }
  return value as unknown as RotaActivationReceipt;
}
async function request(path: string, signal: AbortSignal, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== 'GET') {
    const csrf = document.cookie.split('; ').find(part => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
    if (!csrf) throw new RotaImportError(401, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.');
    headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  const response = await fetch(`${config.apiBase}${path}`, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const message = response.status === 409 ? 'Preview đã thay đổi. Tải lại phiên và xem thay đổi mới trước khi xác nhận.' :
      response.status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' : response.status === 403 ? 'Bạn không còn quyền với resource pool này.' :
      response.status === 404 ? 'Resource pool hoặc phiên import không còn khả dụng.' : 'Không hoàn tất được yêu cầu kích hoạt.';
    throw new RotaImportError(response.status, message);
  }
  return response;
}
async function json<T>(path: string, signal: AbortSignal, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  const response = await request(path, signal, init);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Phản hồi API không phải JSON hợp lệ.'); }
  return parse(body);
}
const idPath = (id: string) => encodeURIComponent(id);
export async function getRotaActivationPreview(importId: string, poolId: string, signal: AbortSignal): Promise<RotaActivationPreview> {
  const result = await json(`/rota-imports/${idPath(importId)}/activation-preview`, signal, undefined, parseActivationPreview);
  if (result.import_id !== importId || result.pool_id !== poolId) throw new Error('Preview kích hoạt thuộc phiên hoặc resource pool khác.');
  return result;
}
export async function activateRota(preview: RotaActivationPreview, confirmFullReplacement: boolean, signal: AbortSignal): Promise<RotaActivationReceipt> {
  const result = await json(`/rota-imports/${idPath(preview.import_id)}/activate`, signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: preview.import_version, pool_version: preview.pool_version, confirm_full_replacement: confirmFullReplacement }),
  }, parseReceipt);
  if (result.import_id !== preview.import_id || result.pool_id !== preview.pool_id || result.import_version !== preview.import_version || result.pool_version !== preview.pool_version + 1) {
    throw new Error('Biên nhận kích hoạt không khớp phiên đã xác nhận.');
  }
  return result;
}
