import { config } from '../config';

export type Capability = 'read' | 'write';
export interface ResourcePool {
  id: string; label: string; connection_id: string; connection_label: string;
  environment: string; orgid: string; timezone: string; capability: Capability;
}
export interface ImportSummary {
  id: string; pool_id: string; version: number; status: string; file_name: string; sheet: string;
  created_at: string; coverage_from: string | null; coverage_before: string | null;
}
export interface RotaIssue {
  kind: string; message: string; source_row: number | null; date: string | null; cell: string | null;
}
export interface RotaDay { date: string; code: string; capacity_hours: number | null }
export interface RotaLabor {
  labor_key: string; connection_id: string; orgid: string; laborcode: string; personid: string;
  displayname: string; title?: string | null; default_crafts: string[];
}
export interface RotaRow {
  source_row: number; name: string; position: string; craft: string | null;
  role: 'TECH' | 'SUP' | 'ASST_SUP' | 'CONTROL_RM_ENGINEER' | 'MATERIAL_CONTROLLER' | null;
  days: RotaDay[]; mapping: RotaLabor | null; candidates: RotaLabor[]; issues: RotaIssue[];
}
export interface RotaPreview extends ImportSummary {
  policy_version: string; labor_snapshot_at: string | null; labor_error: string | null;
  source_errors: RotaIssue[]; rows: RotaRow[]; excluded_labor_count: number;
  excluded_position_count?: number;
  excluded_positions?: { source_row: number; name: string; position: string }[];
  summary: { rota_people: number; mapped_people: number; blocking_count: number; capacity_hours: number };
}

export class RotaImportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const requiredString = (value: unknown) => typeof value === 'string' && value.length > 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

function parsePool(value: unknown): ResourcePool {
  if (!isRecord(value) || !['id', 'label', 'connection_id', 'connection_label', 'environment', 'orgid', 'timezone'].every(key => requiredString(value[key])) ||
      !['read', 'write'].includes(String(value.capability))) throw new Error('Danh sách resource pool không hợp lệ.');
  return value as unknown as ResourcePool;
}
function parseSummary(value: unknown): ImportSummary {
  if (!isRecord(value) || !['id', 'pool_id', 'status', 'file_name', 'sheet', 'created_at'].every(key => requiredString(value[key])) ||
      !Number.isInteger(value.version) || Number(value.version) < 1 || !nullableString(value.coverage_from) || !nullableString(value.coverage_before)) {
    throw new Error('Thông tin phiên import không hợp lệ.');
  }
  return value as unknown as ImportSummary;
}
function parseIssue(value: unknown): RotaIssue {
  if (!isRecord(value) || !requiredString(value.kind) || !requiredString(value.message) ||
      !(value.source_row === null || (Number.isInteger(value.source_row) && Number(value.source_row) > 0)) ||
      !nullableString(value.date) || !nullableString(value.cell)) throw new Error('Chi tiết lỗi rota không hợp lệ.');
  return value as unknown as RotaIssue;
}
function parseLabor(value: unknown): RotaLabor {
  if (!isRecord(value) || !['labor_key', 'connection_id', 'orgid', 'laborcode', 'personid', 'displayname'].every(key => requiredString(value[key])) ||
      !(value.title === undefined || nullableString(value.title) && (value.title === null || String(value.title).length <= 200)) ||
      !Array.isArray(value.default_crafts) || !value.default_crafts.every(requiredString)) throw new Error('LABOR candidate không hợp lệ.');
  return value as unknown as RotaLabor;
}
function parseRow(value: unknown): RotaRow {
  const roles = ['TECH', 'SUP', 'ASST_SUP', 'CONTROL_RM_ENGINEER', 'MATERIAL_CONTROLLER'];
  if (!isRecord(value) || !Number.isInteger(value.source_row) || Number(value.source_row) < 1 ||
      !requiredString(value.name) || typeof value.position !== 'string' || !nullableString(value.craft) ||
      !(value.role === null || roles.includes(String(value.role))) || !Array.isArray(value.days) ||
      !value.days.every(day => isRecord(day) && requiredString(day.date) && typeof day.code === 'string' && nullableNumber(day.capacity_hours)) ||
      !(value.mapping === null || isRecord(value.mapping)) || !Array.isArray(value.candidates) || !value.candidates.every(item => isRecord(item)) ||
      !Array.isArray(value.issues)) throw new Error('Dòng rota không hợp lệ.');
  const candidates = value.candidates.map(parseLabor);
  if (new Set(candidates.map(item => item.labor_key)).size !== candidates.length) throw new Error('LABOR candidate bị trùng.');
  const mapping = value.mapping === null ? null : parseLabor(value.mapping);
  if (mapping && !candidates.some(item => item.labor_key === mapping.labor_key)) throw new Error('Mapping LABOR không nằm trong danh sách ứng viên của dòng.');
  return { ...value, days: value.days as RotaDay[], candidates, mapping, issues: value.issues.map(parseIssue) } as RotaRow;
}
export function parseRotaPreview(value: unknown): RotaPreview {
  const summaryValue = isRecord(value) ? value.summary : undefined;
  if (!isRecord(value) || !requiredString(value.policy_version) || !nullableString(value.labor_snapshot_at) || !nullableString(value.labor_error) ||
      !Array.isArray(value.source_errors) || !Array.isArray(value.rows) || !Number.isInteger(value.excluded_labor_count) || Number(value.excluded_labor_count) < 0 ||
      !isRecord(summaryValue) || !['rota_people', 'mapped_people', 'blocking_count'].every(key => Number.isInteger(summaryValue[key]) && Number(summaryValue[key]) >= 0) ||
      typeof summaryValue.capacity_hours !== 'number' || !Number.isFinite(summaryValue.capacity_hours)) throw new Error('Preview rota không hợp lệ.');
  const summary = parseSummary(value);
  if (value.excluded_position_count !== undefined && (!Number.isInteger(value.excluded_position_count) || Number(value.excluded_position_count) < 0)) throw new Error('Số chức danh loại khỏi Labor không hợp lệ.');
  if (value.excluded_positions !== undefined && (!Array.isArray(value.excluded_positions) || !value.excluded_positions.every(item =>
    isRecord(item) && Number.isInteger(item.source_row) && Number(item.source_row) > 0 && requiredString(item.name) && requiredString(item.position)))) throw new Error('Danh sách chức danh loại khỏi Labor không hợp lệ.');
  if (value.excluded_positions !== undefined && value.excluded_position_count !== value.excluded_positions.length) throw new Error('Số chức danh bị loại không khớp danh sách.');
  const rows = value.rows.map(parseRow);
  if (summary.id.length === 0 || summaryValue.rota_people !== rows.length) throw new Error('Số người trong preview không khớp.');
  return { ...value, ...summary, source_errors: value.source_errors.map(parseIssue), rows, summary: summaryValue as RotaPreview['summary'] } as RotaPreview;
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
    const messages: Record<number, string> = {
      401: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
      403: 'Bạn không còn quyền với resource pool này.',
      404: 'Resource pool hoặc phiên import không còn khả dụng.',
      409: 'Preview đã được cập nhật ở nơi khác. Tải lại phiên đã lưu trước khi sửa tiếp.',
      413: 'File vượt giới hạn dung lượng cho phép.',
      415: 'Định dạng file chưa được hỗ trợ.',
      422: 'File rota chưa hợp lệ. Kiểm tra sheet, dòng và ô được báo lỗi.',
      502: 'Không lấy được LABOR từ Maximo. Phiên staging vẫn được lưu; có thể làm mới LABOR sau.',
      503: 'Resource pool hoặc kết nối LABOR chưa sẵn sàng.',
    };
    throw new RotaImportError(response.status, messages[response.status] ?? 'Yêu cầu chưa hoàn tất. Hãy thử lại.');
  }
  return response;
}
async function json<T>(path: string, signal: AbortSignal, init: RequestInit | undefined, parse: (v: unknown) => T): Promise<T> {
  const response = await request(path, signal, init);
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error('Phản hồi API không phải JSON hợp lệ.'); }
  return parse(raw);
}
const params = (values: Record<string, string>) => new URLSearchParams(values).toString();
const pathId = (id: string) => encodeURIComponent(id);

export async function listResourcePools(signal: AbortSignal): Promise<ResourcePool[]> {
  return json('/resource-pools', signal, undefined, body => {
    if (!isRecord(body) || !Array.isArray(body.items)) throw new Error('Danh sách resource pool không hợp lệ.');
    const items = body.items.map(parsePool);
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Resource pool bị trùng.');
    return items;
  });
}
export async function listRotaImports(poolId: string, signal: AbortSignal): Promise<ImportSummary[]> {
  return json(`/rota-imports?${params({ pool_id: poolId })}`, signal, undefined, body => {
    if (!isRecord(body) || !Array.isArray(body.items)) throw new Error('Danh sách phiên import không hợp lệ.');
    const items = body.items.map(parseSummary);
    if (items.some(item => item.pool_id !== poolId)) throw new Error('Phiên import thuộc resource pool khác.');
    return items;
  });
}
export async function getRotaImport(id: string, poolId: string, signal: AbortSignal): Promise<RotaPreview> {
  const preview = await json(`/rota-imports/${pathId(id)}`, signal, undefined, parseRotaPreview);
  if (preview.pool_id !== poolId || preview.id !== id) throw new Error('Phiên import thuộc resource pool khác.');
  return preview;
}
export async function uploadRotaImport(poolId: string, file: File, sheet: string, signal: AbortSignal): Promise<RotaPreview> {
  const preview = await json(`/rota-imports?${params({ pool_id: poolId, filename: file.name, sheet })}`, signal,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }, parseRotaPreview);
  if (preview.pool_id !== poolId) throw new Error('Phiên import thuộc resource pool khác.');
  return preview;
}
async function mutate(id: string, action: 'mapping' | 'refresh-labor' | 'cancel', body: unknown, poolId: string, signal: AbortSignal): Promise<RotaPreview> {
  const preview = await json(`/rota-imports/${pathId(id)}/${action}`, signal,
    { method: action === 'mapping' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, parseRotaPreview);
  if (preview.pool_id !== poolId || preview.id !== id) throw new Error('Phiên import thuộc resource pool khác.');
  return preview;
}
export const updateRotaMapping = (preview: RotaPreview, sourceRow: number, laborKey: string | null, signal: AbortSignal) =>
  mutate(preview.id, 'mapping', { version: preview.version, source_row: sourceRow, labor_key: laborKey }, preview.pool_id, signal);
export const refreshRotaLabor = (preview: RotaPreview, signal: AbortSignal) =>
  mutate(preview.id, 'refresh-labor', { version: preview.version }, preview.pool_id, signal);
export const cancelRotaImport = (preview: RotaPreview, signal: AbortSignal) =>
  mutate(preview.id, 'cancel', { version: preview.version }, preview.pool_id, signal);
