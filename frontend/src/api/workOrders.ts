import { config } from '../config';
import { isAwareDate } from './dates';
import type { Changes } from './drafts';

export type PlanningMarker = { draft_id: string; version: number; is_batch: boolean; updated_at: string;
  changes: Changes; baseline_changed: boolean };

export const columns = [
  ['wolo10', '% Complete'], ['bdpocdiscipline', 'Discipline'], ['wonum', 'Work Order'],
  ['description', 'Description'], ['worktype', 'Work Type'], ['location', 'Tag Name'],
  ['systemid', 'System ID'], ['schedstart', 'Scheduled Start'], ['schedfinish', 'Scheduled Finish'],
  ['actstart', 'Actual Start'], ['actfinish', 'Actual Finish'], ['status', 'Status'],
  ['wopriority_description', 'Priority'], ['lead', 'Onshore PIC'], ['assignedtechname', 'Assigned PIC'],
  ['estdur', 'Est. Duration'], ['targstartdate', 'Target Start'], ['targcompdate', 'Target Finish'],
  ['workorderid', 'WOID'],
] as const;
type Field = typeof columns[number][0];
export type WorkOrder = Record<Field, string | null> & { siteid: string; wonum: string; workorderid: string; worktype: string; status: string; targcompdate: string; wopriority: number | null; drafts?: PlanningMarker[] };
export type WorkOrderFilter = { connection_id: string; discipline: string; target_from: string; target_before: string };

export class RetrievalError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function validateRange(start: string, end: string): void {
  const duration = Date.parse(end) - Date.parse(start);
  if (!isAwareDate(start) || !isAwareDate(end) || duration <= 0 || duration > 366 * 86400000) {
    throw new Error('Nhập ngày giờ ISO có múi giờ; mốc cuối phải sau mốc đầu, tối đa 366 ngày.');
  }
}

export async function retrieveWorkOrders(filter: WorkOrderFilter, signal: AbortSignal): Promise<WorkOrder[]> {
  validateRange(filter.target_from, filter.target_before);
  const response = await fetch(`${config.apiBase}/work-orders?${new URLSearchParams(filter)}`, {
    signal, credentials: 'same-origin', cache: 'no-store',
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
      404: 'Phạm vi không còn được cấp quyền. Hãy kiểm tra lại phiên đăng nhập.',
      422: 'Bộ lọc chưa hợp lệ. Kiểm tra khoảng ngày và múi giờ.',
      502: 'Không lấy được đầy đủ dữ liệu Maximo. Thử thu hẹp khoảng ngày hoặc liên hệ IT.',
      503: 'Kết nối dữ liệu chưa sẵn sàng hoặc chưa được cấu hình.',
    };
    throw new RetrievalError(response.status, messages[response.status] ?? 'Không lấy được dữ liệu. Hãy thử lại.');
  }
  const body: unknown = await response.json();
  const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
  if (!object(body) || body.connection_id !== filter.connection_id || body.discipline !== filter.discipline ||
      !Array.isArray(body.items) || body.count !== body.items.length) throw new Error('Phản hồi dữ liệu không hợp lệ.');
  const keys = new Set<string>();
  return body.items.map((raw: unknown) => {
    const row = parseWorkOrder(raw, filter.discipline);
    const key = JSON.stringify([row.siteid, row.workorderid]);
    if (keys.has(key)) throw new Error('Phản hồi chứa WO trùng định danh.');
    keys.add(key);
    return row;
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseWorkOrder(raw: unknown, discipline: string): WorkOrder {
    if (!isRecord(raw) || typeof raw.siteid !== 'string' || !raw.siteid || raw.bdpocdiscipline !== discipline ||
        !columns.every(([field]) => raw[field] === null || typeof raw[field] === 'string') ||
        !['wonum', 'workorderid', 'worktype', 'status', 'targcompdate'].every((field) => typeof raw[field] === 'string' && raw[field]) ||
        !(raw.wopriority === null || (typeof raw.wopriority === 'number' && Number.isInteger(raw.wopriority)))) {
      throw new Error('Phản hồi WO không hợp lệ.');
    }
  return { ...raw, drafts: parsePlanningMarkers(raw.drafts ?? []) } as WorkOrder;
}

export function parsePlanningMarkers(raw: unknown): PlanningMarker[] {
  if (!Array.isArray(raw)) throw new Error('Phản hồi kế hoạch không hợp lệ.');
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.draft_id !== 'string' || !item.draft_id || ids.has(item.draft_id) ||
      !Number.isInteger(item.version) || Number(item.version) < 1 || typeof item.is_batch !== 'boolean' ||
      typeof item.baseline_changed !== 'boolean' || typeof item.updated_at !== 'string' || !isAwareDate(item.updated_at) || !isRecord(item.changes) ||
      !Object.entries(item.changes).every(([key, value]) => key === 'change_target' ? typeof value === 'boolean' :
        ['schedstart', 'schedfinish', 'assignedtechname', 'estdur', 'targstartdate', 'targcompdate'].includes(key) && typeof value === 'string')) {
      throw new Error('Phản hồi kế hoạch không hợp lệ.');
    }
    ids.add(item.draft_id);
  }
  return raw as PlanningMarker[];
}
