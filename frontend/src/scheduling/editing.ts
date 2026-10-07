import { editableFields, type Baseline, type Changes, type EditableField } from '../api/drafts';
import { isAwareDate } from '../api/dates';

export function equalField(field: EditableField, value: string, original: string | null): boolean {
  if (value === (original ?? '')) return true;
  if (original === null) return false;
  if (field === 'estdur' && /^\d+(\.\d+)?$/.test(value) && /^\d+(\.\d+)?$/.test(original)) {
    const normalize = (number: string) => number.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return normalize(value) === normalize(original);
  }
  return field !== 'estdur' && field !== 'assignedtechname' && isAwareDate(value) && isAwareDate(original) && Date.parse(value) === Date.parse(original);
}

export function changedValue(changes: Changes, baseline: Baseline, field: EditableField, value: string): Changes {
  const next = { ...changes };
  if (equalField(field, value, baseline[field])) delete next[field]; else next[field] = value;
  return next;
}

export function scheduledChange(changes: Changes, baseline: Baseline, field: EditableField, value: string): Changes {
  const next = changedValue(changes, baseline, field, value);
  if (field !== 'schedstart' && field !== 'estdur') return next;
  const start = next.schedstart ?? baseline.schedstart;
  const duration = next.estdur ?? baseline.estdur;
  if (!start || !isAwareDate(start) || !duration || !/^\d+(\.\d+)?$/.test(duration)) return next;
  // Duration is elapsed hours; no shift calendar or working-day assumptions.
  const finish = Date.parse(start) + Math.round(Number(duration) * 3600000);
  if (!Number.isFinite(finish) || Math.abs(finish) > 8640000000000000) return { ...next, schedfinish: '' };
  const date = new Date(finish).toISOString();
  return changedValue(next, baseline, 'schedfinish', isAwareDate(date) ? date : '');
}

export function validateChanges(baseline: Baseline, changes: Changes, pics: string[]): string {
  for (const field of editableFields) {
    const value = changes[field];
    if (value === undefined) continue;
    if (!value.trim()) return 'Chưa hỗ trợ xóa giá trị. Dùng Reset để bỏ thay đổi.';
    if (field === 'estdur') {
      if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return 'Duration phải là số không âm.';
    } else if (field === 'assignedtechname') {
      if (!pics.includes(value)) return 'Chọn PIC thuộc crew được cấp.';
    } else if (!isAwareDate(value)) return 'Ngày giờ phải hợp lệ và có timezone.';
  }
  if (changes.schedstart !== undefined || changes.estdur !== undefined) {
    const start = changes.schedstart ?? baseline.schedstart;
    const duration = changes.estdur ?? baseline.estdur;
    if (start && (duration === null || !duration.trim())) return 'Nhập Est. Duration (giờ) để tính Scheduled Finish.';
  }
  for (const [start, end] of [['schedstart', 'schedfinish'], ['targstartdate', 'targcompdate']] as const) {
    if (changes[start] === undefined && changes[end] === undefined) continue;
    const a = changes[start] ?? baseline[start], b = changes[end] ?? baseline[end];
    if (!a || !b || Date.parse(b) < Date.parse(a)) return 'Cần đủ ngày bắt đầu/kết thúc; kết thúc không được trước bắt đầu.';
  }
  return '';
}
