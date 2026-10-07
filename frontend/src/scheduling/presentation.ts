import { columns, type WorkOrder } from '../api/workOrders';

// Technical record identity remains in API data, never in presentation columns.
export const dataColumns = columns.filter(([field]) => field !== 'systemid' && field !== 'workorderid');
export function fieldValue(row: WorkOrder, field: keyof WorkOrder, timezone: string): string {
  const value = row[field];
  if (field === 'wopriority_description') return `${value ?? '—'} (${row.wopriority ?? '—'})`;
  if (value === null) return '—';
  if (['schedstart', 'schedfinish', 'actstart', 'actfinish', 'targstartdate', 'targcompdate'].includes(field)) {
    return displayDate(String(value), timezone);
  }
  if (field === 'wolo10') return `${value}%`;
  return String(value);
}

export function rowKey(row: WorkOrder): string {
  return JSON.stringify([row.siteid, row.workorderid]);
}

export function displayDate(value: string | null, timeZone: string, withTime = true): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}) }).format(new Date(value));
}
