import { expect, it } from 'vitest';
import type { Baseline } from '../api/drafts';
import { scheduledChange, validateChanges } from './editing';

const baseline: Baseline = { worktype: 'CM', schedstart: null, schedfinish: null, estdur: '10.5',
  assignedtechname: null, targstartdate: null, targcompdate: null };

it('derives fractional-hour duration and recalculates when duration changes', () => {
  const start = scheduledChange({}, baseline, 'schedstart', '2026-10-05T08:00:00+07:00');
  expect(start.schedfinish).toBe('2026-10-05T11:30:00.000Z');
  expect(scheduledChange(start, baseline, 'estdur', '12').schedfinish).toBe('2026-10-05T13:00:00.000Z');
  expect(scheduledChange(start, baseline, 'estdur', '0').schedfinish).toBe('2026-10-05T01:00:00.000Z');
});

it('crosses midnight using elapsed hours', () => {
  expect(scheduledChange({}, { ...baseline, estdur: '2' }, 'schedstart', '2026-10-05T23:30:00+07:00').schedfinish)
    .toBe('2026-10-05T18:30:00.000Z');
});

it('requires duration when scheduling and does not rewrite unrelated existing dates', () => {
  const scheduled = { ...baseline, schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-31T08:00:00+07:00' };
  expect(scheduledChange({}, scheduled, 'assignedtechname', 'TECH')).toEqual({ assignedtechname: 'TECH' });
  expect(validateChanges({ ...baseline, estdur: null }, { schedstart: '2026-10-05T08:00:00+07:00' }, []))
    .toContain('Nhập Est. Duration');
  const bad = scheduledChange({}, baseline, 'schedstart', '2026-10-05T08:00:00+07:00');
  expect(validateChanges(baseline, scheduledChange(bad, baseline, 'estdur', '-1'), [])).toContain('không âm');
});

it('contains the complete schedule within inclusive effective target bounds by exact instant', () => {
  const bounded = { ...baseline, schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-05T10:00:00+07:00', estdur: '2', targstartdate: '2026-10-05T08:00:00+07:00',
    targcompdate: '2026-10-05T10:00:00+07:00' };
  const valid = { schedstart: '2026-10-05T01:00:00Z' };
  expect(validateChanges(bounded, valid, [])).toBe('');
  expect(validateChanges(bounded, scheduledChange({}, bounded, 'schedstart', '2026-10-05T07:59:00+07:00'), [])).toContain('Scheduled Start');
  expect(validateChanges(bounded, scheduledChange({}, bounded, 'estdur', '2.01'), [])).toContain('Scheduled Finish');
  expect(validateChanges(bounded, { targstartdate: '2026-10-05T08:01:00+07:00', change_target: true }, [])).toContain('Scheduled Start');
  expect(validateChanges(bounded, { targcompdate: '2026-10-05T09:59:00+07:00', change_target: true }, [])).toContain('Scheduled Finish');
});

it('uses target overrides, accepts one-sided bounds, compares offsets as instants and fails closed on invalid bounds', () => {
  const oneSided = { ...baseline, estdur: '1', targstartdate: '2026-10-05T01:00:00Z' };
  const sameInstant = scheduledChange({}, oneSided, 'schedstart', '2026-10-05T08:00:00+07:00');
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
