import { startOfDay } from '../api/dates';

// Offshore shift: one window per day, 06:30 to 18:30, with at most 10.5 working hours in it
// (meals and rest are already inside those 10.5 hours). All 7 days of the week count.
export const SHIFT_START_MINUTES = 6 * 60 + 30;
export const SHIFT_END_MINUTES = 18 * 60 + 30;
export const DAILY_WORK_MINUTES = 10 * 60 + 30;

type LocalTime = { date: string; minutes: number };

function localTime(instant: number, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${pick('year')}-${pick('month')}-${pick('day')}`, minutes: Number(pick('hour')) * 60 + Number(pick('minute')) };
}

function nextDate(date: string, days = 1): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// The business timezone has a fixed offset within a day, so local midnight plus minutes is the wall-clock instant.
const instantAt = (date: string, minutes: number, timeZone: string) => Date.parse(startOfDay(date, timeZone)) + minutes * 60000;

export type ShiftPosition = 'inside' | 'before' | 'after';

export function shiftPosition(start: string, timeZone: string): ShiftPosition {
  const { minutes } = localTime(Date.parse(start), timeZone);
  return minutes < SHIFT_START_MINUTES ? 'before' : minutes >= SHIFT_END_MINUTES ? 'after' : 'inside';
}

/** Start of the shift window nearest in time to `start` (a tie, exactly 18:30, goes to the next day). */
export function nearestShiftStart(start: string, timeZone: string): string {
  const instant = Date.parse(start);
  const { date } = localTime(instant, timeZone);
  const candidates = [instantAt(date, SHIFT_START_MINUTES, timeZone), instantAt(nextDate(date), SHIFT_START_MINUTES, timeZone)];
  const [today, tomorrow] = candidates;
  const chosen = Math.abs(instant - tomorrow) <= Math.abs(instant - today) ? tomorrow : today;
  return new Date(chosen).toISOString();
}

/**
 * Scheduled finish for `durationHours` of work beginning at `start`. Each day offers
 * min(10.5 h, time left before 18:30); a start outside the window begins at the next window opening.
 * Returns null when the inputs are not usable.
 */
export function workingFinish(start: string, durationHours: number, timeZone: string): string | null {
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs) || !Number.isFinite(durationHours) || durationHours < 0) return null;
  let remaining = Math.round(durationHours * 60);
  if (remaining === 0) return new Date(startMs).toISOString();
  let { date, minutes } = localTime(startMs, timeZone);
  if (minutes >= SHIFT_END_MINUTES) { date = nextDate(date); minutes = SHIFT_START_MINUTES; }
  else if (minutes < SHIFT_START_MINUTES) minutes = SHIFT_START_MINUTES;
  for (let guard = 0; guard < 20000; guard++) {
    const available = Math.min(DAILY_WORK_MINUTES, SHIFT_END_MINUTES - minutes);
    if (remaining <= available) return new Date(instantAt(date, minutes + remaining, timeZone)).toISOString();
    remaining -= available;
    date = nextDate(date); minutes = SHIFT_START_MINUTES;
  }
  return null;
}
