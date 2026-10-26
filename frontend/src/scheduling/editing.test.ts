import { expect, it } from 'vitest';
import type { Baseline } from '../api/drafts';
import { scheduledChange, validateChanges } from './editing';

const tz = 'Asia/Ho_Chi_Minh';
const baseline: Baseline = { worktype: 'CM', schedstart: null, schedfinish: null, estdur: '10.5',
  assignedto: null, targstartdate: null, targcompdate: null };

it('derives fractional-hour duration and recalculates when duration changes', () => {
  const start = scheduledChange({}, baseline, 'schedstart', '2026-10-05T08:00:00+07:00', tz);
  expect(start.schedfinish).toBe('2026-10-05T11:30:00.000Z');
  // 10.5 h fill the day to 18:30; the remaining 1.5 h run from 06:30 the next morning.
  expect(scheduledChange(start, baseline, 'estdur', '12', tz).schedfinish).toBe('2026-10-06T01:00:00.000Z');
  expect(scheduledChange(start, baseline, 'estdur', '0', tz).schedfinish).toBe('2026-10-05T01:00:00.000Z');
});

it('counts a late start from the next window opening (06:30) instead of elapsed hours', () => {
  expect(scheduledChange({}, { ...baseline, estdur: '2' }, 'schedstart', '2026-10-05T23:30:00+07:00', tz).schedfinish)
    .toBe('2026-10-06T01:30:00.000Z');
});

it('limits a day to 10.5 hours and counts all seven days', () => {
  // Friday 06:30 plus 21 h is two full days, ending Saturday 17:00 local.
  expect(scheduledChange({}, { ...baseline, estdur: '21' }, 'schedstart', '2026-10-09T06:30:00+07:00', tz).schedfinish)
    .toBe('2026-10-10T10:00:00.000Z');
});

it('asks to update Target Finish when the working-day finish passes it', () => {
  const bounded = { ...baseline, estdur: '300', schedstart: null, schedfinish: null, targstartdate: '2026-10-01T00:00:00+07:00', targcompdate: '2026-10-31T23:59:00+07:00' };
  const changes = scheduledChange({}, bounded, 'schedstart', '2026-10-08T09:58:00+07:00', tz);
  expect(validateChanges(bounded, changes, [])).toContain('Cập nhật Target Finish');
});

it('requires duration when scheduling and does not rewrite unrelated existing dates', () => {
  const scheduled = { ...baseline, schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-31T08:00:00+07:00' };
  expect(scheduledChange({}, scheduled, 'assignedto', 'TECH', tz)).toEqual({ assignedto: 'TECH' });
  expect(validateChanges({ ...baseline, estdur: null }, { schedstart: '2026-10-05T08:00:00+07:00' }, []))
    .toContain('Nhập Est. Duration');
  const bad = scheduledChange({}, baseline, 'schedstart', '2026-10-05T08:00:00+07:00', tz);
  expect(validateChanges(baseline, scheduledChange(bad, baseline, 'estdur', '-1', tz), [])).toContain('không âm');
});

it('contains the complete schedule within inclusive effective target bounds by exact instant', () => {
  const bounded = { ...baseline, schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-05T10:00:00+07:00', estdur: '2', targstartdate: '2026-10-05T08:00:00+07:00',
    targcompdate: '2026-10-05T10:00:00+07:00' };
  const valid = { schedstart: '2026-10-05T01:00:00Z' };
  expect(validateChanges(bounded, valid, [])).toBe('');
  expect(validateChanges(bounded, scheduledChange({}, bounded, 'schedstart', '2026-10-05T07:59:00+07:00', tz), [])).toContain('Scheduled Start');
  expect(validateChanges(bounded, scheduledChange({}, bounded, 'estdur', '2.01', tz), [])).toContain('Scheduled Finish');
  expect(validateChanges(bounded, { targstartdate: '2026-10-05T08:01:00+07:00', change_target: true }, [])).toContain('Scheduled Start');
  expect(validateChanges(bounded, { targcompdate: '2026-10-05T09:59:00+07:00', change_target: true }, [])).toContain('Scheduled Finish');
});

it('uses target overrides, accepts one-sided bounds, compares offsets as instants and fails closed on invalid bounds', () => {
  const oneSided = { ...baseline, estdur: '1', targstartdate: '2026-10-05T01:00:00Z' };
  const sameInstant = scheduledChange({}, oneSided, 'schedstart', '2026-10-05T08:00:00+07:00', tz);
  expect(validateChanges(oneSided, sameInstant, [])).toBe('');
  const withPair = { ...oneSided, targcompdate: '2026-10-05T11:00:00+07:00' };
  const relaxed = { ...sameInstant, targstartdate: '2026-10-05T07:00:00+07:00', change_target: true };
  expect(validateChanges(withPair, relaxed, [])).toBe('');
  expect(validateChanges({ ...oneSided, targstartdate: 'invalid' }, sameInstant, [])).toContain('Target');
  expect(validateChanges({ ...oneSided, worktype: 'PM' }, sameInstant, [])).toBe('');
  expect(validateChanges({ ...oneSided, worktype: 'CFT' }, sameInstant, [])).toBe('');
  expect(validateChanges({ ...oneSided, targcompdate: '2026-10-05T02:00:00Z', schedstart: null, schedfinish: '2026-10-05T00:30:00Z' },
    { targstartdate: '2026-10-05T01:00:00Z', targcompdate: '2026-10-05T02:00:00Z', change_target: true }, [])).toContain('Scheduled Finish');
  expect(validateChanges({ ...oneSided, targstartdate: '2026-10-05T10:00:00Z', targcompdate: '2026-10-05T09:00:00Z' }, sameInstant, [])).toContain('Target Finish');
  expect(validateChanges({ ...withPair, schedstart: '2026-10-05T10:00:00Z', schedfinish: '2026-10-05T09:00:00Z' },
    { targcompdate: '2026-10-05T12:00:00+07:00', change_target: true }, [])).toContain('kết thúc không được trước bắt đầu');
});
