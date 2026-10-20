import { describe, expect, it } from 'vitest';
import { formatWall, isValidDate, minuteOptions, monthGrid, parseWall, shiftMonth } from './calendar';

describe('calendar helpers', () => {
  it('formats and parses 24 hour wall times', () => {
    expect(formatWall('2026-10-01T08:05')).toBe('01/10/2026 08:05');
    expect(formatWall('')).toBe('');
    expect(parseWall('01/10/2026 08:05', '06:30')).toBe('2026-10-01T08:05');
    expect(parseWall('1/2/2026 9:58', '06:30')).toBe('2026-02-01T09:58');
    expect(parseWall('15/03/2026', '06:30')).toBe('2026-03-15T06:30');
  });

  it('rejects impossible dates and times', () => {
    for (const text of ['31/02/2026 08:00', '01/13/2026 08:00', '01/10/2026 24:00', '01/10/2026 08:60', 'abc', '01-10-2026 08:00', '01/10/2026 8:5']) {
      expect(parseWall(text, '06:30')).toBeNull();
    }
    expect(isValidDate(2028, 2, 29)).toBe(true);
    expect(isValidDate(2026, 2, 29)).toBe(false);
  });

  it('builds six Monday-first weeks around the month', () => {
    const weeks = monthGrid('2026-10');
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // 1 October 2026 is a Thursday, so the grid starts on Monday 28 September.
    expect(weeks[0][0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(weeks[0][3]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(31);
  });

  it('moves between months across a year boundary', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('offers 5-minute steps and keeps an off-grid current value visible', () => {
    expect(minuteOptions('')).toHaveLength(12);
    expect(minuteOptions('30')).toHaveLength(12);
    expect(minuteOptions('58')).toContain('58');
    expect(minuteOptions('58')[minuteOptions('58').length - 1]).toBe('58');
  });
});
