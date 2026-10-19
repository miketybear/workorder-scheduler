import { describe, expect, it } from 'vitest';
import { scheduleRange } from './timelineHelpers';

const now = new Date('2026-10-19T03:00:00Z');

describe('scheduleRange', () => {
  it('formats both ends as dates in the business timezone', () => {
    expect(scheduleRange('2026-10-04T15:06:00+07:00', '2026-10-31T15:06:00+07:00', 'Asia/Ho_Chi_Minh', now)).toBe('04/10 → 31/10');
  });

  it('uses the timezone, not the offset text, to decide the calendar day', () => {
    // 20:00Z on the 3rd is already the 4th in Ho Chi Minh.
    expect(scheduleRange('2026-10-03T20:00:00Z', '2026-10-05T10:00:00Z', 'Asia/Ho_Chi_Minh', now)).toBe('04/10 → 05/10');
  });

  it('adds the year when an end is not in the current year', () => {
    expect(scheduleRange('2026-12-30T08:00:00+07:00', '2027-01-02T08:00:00+07:00', 'Asia/Ho_Chi_Minh', now)).toBe('30/12 → 02/01/2027');
  });

  it('returns null when an end is missing or invalid', () => {
    expect(scheduleRange(null, '2026-10-05T10:00:00Z', 'UTC', now)).toBeNull();
    expect(scheduleRange('2026-10-05T10:00:00Z', null, 'UTC', now)).toBeNull();
    expect(scheduleRange('not a date', '2026-10-05T10:00:00Z', 'UTC', now)).toBeNull();
  });
});
