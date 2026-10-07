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
