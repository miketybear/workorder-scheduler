import { config } from '../config';
import { isRecord, type WorkOrderFilter } from './workOrders';

export type HomeSummary = { total: number; missing_schedule: number; missing_pic: number; overdue: number;
  drafts: number; unresolved_uploads: number; unresolved_routes: number; as_of: string };

const COUNTS = ['total', 'missing_schedule', 'missing_pic', 'overdue', 'drafts', 'unresolved_uploads', 'unresolved_routes'] as const;

export function parseHomeSummary(raw: unknown): HomeSummary {
  // A missing count must never read as zero: zero tells the planner nothing is wrong.
  if (!isRecord(raw) || typeof raw.as_of !== 'string' || COUNTS.some((key) => typeof raw[key] !== 'number')) throw new Error('Phản hồi không hợp lệ.');
  return raw as unknown as HomeSummary;
}

export async function getHomeSummary(filter: WorkOrderFilter, signal: AbortSignal): Promise<HomeSummary> {
  const response = await fetch(`${config.apiBase}/home/summary?${new URLSearchParams(filter)}`, { signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Không đọc được số liệu.');
  return parseHomeSummary(await response.json());
}
