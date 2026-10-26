import { editableFields, type Baseline, type Changes, type EditableField } from '../api/drafts';
import { isAwareDate } from '../api/dates';
import { workingFinish } from './workShift';

export function equalField(field: EditableField, value: string, original: string | null): boolean {
  if (value === (original ?? '')) return true;
  if (original === null) return false;
  if (field === 'estdur' && /^\d+(\.\d+)?$/.test(value) && /^\d+(\.\d+)?$/.test(original)) {
    const normalize = (number: string) => number.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return normalize(value) === normalize(original);
  }
  return field !== 'estdur' && field !== 'assignedto' && isAwareDate(value) && isAwareDate(original) && Date.parse(value) === Date.parse(original);
}

export function changedValue(changes: Changes, baseline: Baseline, field: EditableField, value: string): Changes {
  const next = { ...changes };
  if (equalField(field, value, baseline[field])) delete next[field]; else next[field] = value;
  return next;
}

export function scheduledChange(changes: Changes, baseline: Baseline, field: EditableField, value: string, timeZone: string): Changes {
  const next = changedValue(changes, baseline, field, value);
  if (field !== 'schedstart' && field !== 'estdur') return next;
  const start = next.schedstart ?? baseline.schedstart;
  const duration = next.estdur ?? baseline.estdur;
  if (!start || !isAwareDate(start) || !duration || !/^\d+(\.\d+)?$/.test(duration)) return next;
  // Duration is working time on the offshore shift (06:30-18:30, at most 10.5 h a day, 7 days a week).
  const finish = workingFinish(start, Number(duration), timeZone);
  return changedValue(next, baseline, 'schedfinish', finish && isAwareDate(finish) ? finish : '');
}

export function validateChanges(baseline: Baseline, changes: Changes, pics: string[]): string {
  for (const field of editableFields) {
    const value = changes[field];
    if (value === undefined) continue;
    if (!value.trim()) return 'Chưa hỗ trợ xóa giá trị. Dùng Reset để bỏ thay đổi.';
    if (field === 'estdur') {
      if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return 'Duration phải là số không âm.';
    } else if (field === 'assignedto') {
      if (!pics.includes(value)) return 'Chọn PIC thuộc crew được cấp.';
    } else if (!isAwareDate(value)) return 'Ngày giờ phải hợp lệ và có timezone.';
  }
  if (changes.schedstart !== undefined || changes.estdur !== undefined) {
    const start = changes.schedstart ?? baseline.schedstart;
    const duration = changes.estdur ?? baseline.estdur;
    if (start && (duration === null || !duration.trim())) return 'Nhập Est. Duration (giờ) để tính Scheduled Finish.';
  }
  for (const [start, end] of [['schedstart', 'schedfinish']] as const) {
    if (changes[start] === undefined && changes[end] === undefined) continue;
    const a = changes[start] ?? baseline[start], b = changes[end] ?? baseline[end];
    if (!a || !b || Date.parse(b) < Date.parse(a)) return 'Cần đủ ngày bắt đầu/kết thúc; kết thúc không được trước bắt đầu.';
  }
  const scheduleFields = ['schedstart', 'schedfinish', 'estdur'] as const;
  const targetFields = ['targstartdate', 'targcompdate'] as const;
  const scheduleTouched = scheduleFields.some((field) => changes[field] !== undefined);
  const targetTouched = targetFields.some((field) => changes[field] !== undefined);
  if (targetTouched) {
    const start = changes.targstartdate ?? baseline.targstartdate;
    const finish = changes.targcompdate ?? baseline.targcompdate;
    if (!start || !finish || !isAwareDate(start) || !isAwareDate(finish) || Date.parse(finish) < Date.parse(start)) {
      return 'Cần đủ ngày bắt đầu/kết thúc; kết thúc không được trước bắt đầu.';
    }
  }
  if (scheduleTouched || targetTouched) {
    const scheduleStart = changes.schedstart ?? baseline.schedstart;
    const scheduleFinish = changes.schedfinish ?? baseline.schedfinish;
    const targetStart = changes.targstartdate ?? baseline.targstartdate;
    const targetFinish = changes.targcompdate ?? baseline.targcompdate;
    if (scheduleStart && scheduleFinish && (!isAwareDate(scheduleStart) || !isAwareDate(scheduleFinish) ||
        Date.parse(scheduleFinish) < Date.parse(scheduleStart))) {
      return 'Cần đủ ngày bắt đầu/kết thúc; kết thúc không được trước bắt đầu.';
    }
    if (targetStart && (!isAwareDate(targetStart) || !Number.isFinite(Date.parse(targetStart))) ||
        targetFinish && (!isAwareDate(targetFinish) || !Number.isFinite(Date.parse(targetFinish)))) {
      return 'Ngày Target hiện có không hợp lệ; hãy sửa Target trước khi thay đổi lịch.';
    }
    if (targetStart && targetFinish && Date.parse(targetFinish) < Date.parse(targetStart))
      return 'Target Finish không được trước Target Start.';
    for (const [scheduleValue, scheduleName] of [[scheduleStart, 'Scheduled Start'], [scheduleFinish, 'Scheduled Finish']] as const) {
      if (!scheduleValue) continue;
      if (!isAwareDate(scheduleValue) || !Number.isFinite(Date.parse(scheduleValue))) return 'Ngày lịch hiện có không hợp lệ.';
      const instant = Date.parse(scheduleValue);
      if (targetStart && instant < Date.parse(targetStart)) return `${scheduleName} phải bằng hoặc sau Target Start.`;
      if (targetFinish && instant > Date.parse(targetFinish)) {
        return scheduleName === 'Scheduled Finish'
          ? 'Scheduled Finish (tính theo giờ làm việc 10,5 giờ/ngày) vượt Target Finish. Cập nhật Target Finish (bật Change Target, chỉ áp dụng cho CM) rồi lưu; WO PM/CFT không đổi được Target nên hãy rút ngắn Est. Duration hoặc dời Scheduled Start sớm hơn.'
          : `${scheduleName} phải bằng hoặc trước Target Finish.`;
      }
    }
  }
  return '';
}
