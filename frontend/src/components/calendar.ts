// Pure date helpers for the date-time picker. Values are wall-clock strings "YYYY-MM-DDTHH:mm" (no timezone).

export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-10-01T08:05" -> "01/10/2026 08:05"; "" for an empty value. */
export function formatWall(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : '';
}

/**
 * Parses "dd/MM/yyyy HH:mm" (24 h) or just "dd/MM/yyyy" (then `defaultTime` applies) into "YYYY-MM-DDTHH:mm".
 * Returns null when the text is not a real date and time.
 */
export function parseWall(text: string, defaultTime: string): string | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(text);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const [hour, minute] = match[4] === undefined ? defaultTime.split(':').map(Number) : [Number(match[4]), Number(match[5])];
  if (!isValidDate(year, month, day) || !Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

export type CalendarDay = { date: string; inMonth: boolean };

/** Six Monday-first weeks covering `month` ("YYYY-MM"). */
export function monthGrid(month: string): CalendarDay[][] {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const day = new Date(Date.UTC(year, number - 1, 1 - offset + week * 7 + weekday));
    const date = `${pad(day.getUTCFullYear(), 4)}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
    return { date, inMonth: day.getUTCMonth() === number - 1 };
  }));
}

export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}`;
}

/** Minutes offered in the popup: every 5 minutes, plus the current value when it is not on that grid. */
export function minuteOptions(current: string): string[] {
  const base = Array.from({ length: 12 }, (_, index) => pad(index * 5));
  return current && !base.includes(current) ? [...base, current].sort() : base;
}
