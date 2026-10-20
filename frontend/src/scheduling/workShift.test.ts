import { describe, expect, it } from 'vitest';
import { nearestShiftStart, shiftPosition, workingFinish } from './workShift';

const tz = 'Asia/Ho_Chi_Minh';
// All expectations are written as local wall-clock times (+07:00) to keep them readable.
const at = (local: string) => new Date(`${local}+07:00`).toISOString();

describe('workingFinish', () => {
  it('uses at most 10.5 hours per day and the 06:30 to 18:30 window', () => {
    expect(workingFinish(at('2026-10-05T06:30:00'), 10.5, tz)).toBe(at('2026-10-05T17:00:00'));
    expect(workingFinish(at('2026-10-05T08:00:00'), 10.5, tz)).toBe(at('2026-10-05T18:30:00'));
    expect(workingFinish(at('2026-10-05T08:00:00'), 11, tz)).toBe(at('2026-10-06T07:00:00'));
    expect(workingFinish(at('2026-10-05T06:30:00'), 10.6, tz)).toBe(at('2026-10-06T06:36:00'));
  });

  it('counts only the time left in the window on the first day', () => {
    // 15:06 leaves 3h24 before 18:30, so 5 hours of work spill 1h36 into the next morning.
    expect(workingFinish(at('2026-10-05T15:06:00'), 5, tz)).toBe(at('2026-10-06T08:06:00'));
  });

  it('spreads a long duration over calendar days, seven days a week', () => {
    // 300 h from Thursday 08/10 09:58: 8h32 on day one, 27 full days, then 7h58 on 05/11.
    expect(workingFinish(at('2026-10-08T09:58:00'), 300, tz)).toBe(at('2026-11-05T14:28:00'));
    // 21 h from Friday 06:30 is exactly two full days and lands on Saturday 17:00.
    expect(workingFinish(at('2026-10-09T06:30:00'), 21, tz)).toBe(at('2026-10-10T17:00:00'));
  });

  it('starts counting at the next window opening when the start is outside the window', () => {
    expect(workingFinish(at('2026-10-05T03:00:00'), 2, tz)).toBe(at('2026-10-05T08:30:00'));
    expect(workingFinish(at('2026-10-05T20:00:00'), 1, tz)).toBe(at('2026-10-06T07:30:00'));
    expect(workingFinish(at('2026-10-05T18:30:00'), 1, tz)).toBe(at('2026-10-06T07:30:00'));
  });

  it('returns the start for zero duration and null for unusable input', () => {
    expect(workingFinish(at('2026-10-05T09:15:00'), 0, tz)).toBe(at('2026-10-05T09:15:00'));
    expect(workingFinish('nope', 5, tz)).toBeNull();
    expect(workingFinish(at('2026-10-05T09:15:00'), -1, tz)).toBeNull();
    expect(workingFinish(at('2026-10-05T09:15:00'), Number.NaN, tz)).toBeNull();
  });

  it('crosses a month end', () => {
    expect(workingFinish(at('2026-10-31T06:30:00'), 21, tz)).toBe(at('2026-11-01T17:00:00'));
  });
});

describe('shiftPosition and nearestShiftStart', () => {
  it('classifies times against the window', () => {
    expect(shiftPosition(at('2026-10-05T06:29:00'), tz)).toBe('before');
    expect(shiftPosition(at('2026-10-05T06:30:00'), tz)).toBe('inside');
    expect(shiftPosition(at('2026-10-05T18:29:00'), tz)).toBe('inside');
    expect(shiftPosition(at('2026-10-05T18:30:00'), tz)).toBe('after');
  });

  it('picks the nearest window opening, with the 18:30 tie going to the next day', () => {
    expect(nearestShiftStart(at('2026-10-05T02:00:00'), tz)).toBe(at('2026-10-05T06:30:00'));
    expect(nearestShiftStart(at('2026-10-05T20:00:00'), tz)).toBe(at('2026-10-06T06:30:00'));
    expect(nearestShiftStart(at('2026-10-05T18:30:00'), tz)).toBe(at('2026-10-06T06:30:00'));
    expect(nearestShiftStart(at('2026-10-05T12:00:00'), tz)).toBe(at('2026-10-05T06:30:00'));
  });
});
