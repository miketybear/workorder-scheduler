// Check calendar fields before Date.parse, which can normalize invalid days.
export function isAwareDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , , offsetHour, offsetMinute] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second ?? 0) <= 59 &&
    Number(offsetHour ?? 0) <= 23 && Number(offsetMinute ?? 0) <= 59 && Number.isFinite(Date.parse(value));
}

export function startOfDay(date: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isAwareDate(`${date}T00:00:00Z`)) {
    throw new Error('Chọn ngày hợp lệ cho khoảng Target Finish.');
  }
  const wallTime = Date.parse(`${date}T00:00:00Z`);
  const offsetFormat = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' });
  const clockFormat = new Intl.DateTimeFormat('en', {
    timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  // Check both sides of a timezone transition; ambiguous/nonexistent midnight is rejected.
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => {
    const name = offsetFormat.formatToParts(wallTime + delta).find((part) => part.type === 'timeZoneName')?.value;
    if (name === 'GMT') return '+00:00';
    if (!name || !/^GMT[+-]\d{2}:\d{2}$/.test(name)) throw new Error('Múi giờ chưa hỗ trợ chọn ngày.');
    return name.slice(3);
  }));
  const [year, month, day] = date.split('-').map(Number);
  const candidates = [...offsets].filter((offset) => {
    const parts = Object.fromEntries(clockFormat.formatToParts(Date.parse(`${date}T00:00:00${offset}`))
      .map((part) => [part.type, part.value]));
    return Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day &&
      Number(parts.hour) === 0 && Number(parts.minute) === 0 && Number(parts.second) === 0;
  });
  if (candidates.length !== 1) throw new Error('Mốc đầu ngày không xác định duy nhất trong múi giờ này.');
  return `${date}T00:00:00${candidates[0]}`;
}
