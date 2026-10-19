import { describe, expect, it } from 'vitest';
import { localDate, scheduleRange, suggestedPic, woWarnings } from './timelineHelpers';

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

describe('woWarnings', () => {
  const tz = 'Asia/Ho_Chi_Minh';
  const info = { schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-10T17:00:00+07:00', pic: 'HAIDQ' };
  const person = (date: string, laborcode: string, name = laborcode) => ({ date, laborcode, name });

  it('has no warnings when nothing is assigned or the header is unknown', () => {
    expect(woWarnings(info, [], tz)).toEqual({ outsideDates: [], picNotAssigned: false });
    expect(woWarnings(undefined, [person('2026-10-20', 'X')], tz)).toEqual({ outsideDates: [], picNotAssigned: false });
  });

  it('flags assignment days outside the WO schedule, inclusive of both boundary days', () => {
    const result = woWarnings(info, [person('2026-10-04', 'HAIDQ'), person('2026-10-05', 'HAIDQ'), person('2026-10-10', 'HAIDQ'), person('2026-10-11', 'HAIDQ'), person('2026-10-11', 'HAIDQ')], tz);
    expect(result.outsideDates).toEqual(['2026-10-04', '2026-10-11']);
    expect(result.picNotAssigned).toBe(false);
  });

  it('does not warn about dates when either schedule end is missing', () => {
    expect(woWarnings({ ...info, schedfinish: null }, [person('2026-12-01', 'HAIDQ')], tz).outsideDates).toEqual([]);
  });

  it('uses the business timezone for the schedule boundary', () => {
    // 20:00Z on the 9th is already the 10th in Ho Chi Minh, so the 10th is inside the schedule.
    const edge = { schedstart: '2026-10-05T00:00:00Z', schedfinish: '2026-10-09T20:00:00Z', pic: null };
    expect(woWarnings(edge, [person('2026-10-10', 'A')], tz).outsideDates).toEqual([]);
    expect(woWarnings(edge, [person('2026-10-11', 'A')], tz).outsideDates).toEqual(['2026-10-11']);
  });

  it('warns when the PIC is not among the assigned people, comparing codes case-insensitively', () => {
    expect(woWarnings(info, [person('2026-10-06', 'NAMTX')], tz).picNotAssigned).toBe(true);
    expect(woWarnings(info, [person('2026-10-06', 'haidq ')], tz).picNotAssigned).toBe(false);
    expect(woWarnings({ ...info, pic: null }, [person('2026-10-06', 'NAMTX')], tz).picNotAssigned).toBe(false);
  });
});

describe('suggestedPic', () => {
  it('picks the earliest assignment day, then the name', () => {
    expect(suggestedPic([{ date: '2026-10-06', laborcode: 'B1', name: 'An' }, { date: '2026-10-05', laborcode: 'C1', name: 'Zoe' }, { date: '2026-10-05', laborcode: 'D1', name: 'Binh' }])).toBe('D1');
  });
  it('returns null when nobody is assigned', () => { expect(suggestedPic([])).toBeNull(); });
});

describe('localDate', () => {
  it('returns the calendar day in the timezone or null', () => {
    expect(localDate('2026-10-03T20:00:00Z', 'Asia/Ho_Chi_Minh')).toBe('2026-10-04');
    expect(localDate(null, 'UTC')).toBeNull();
    expect(localDate('nope', 'UTC')).toBeNull();
  });
});
