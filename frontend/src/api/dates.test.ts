import { expect, it } from 'vitest';
import { startOfDay } from './dates';

it('uses the configured timezone, including fractional offsets and seasonal changes', () => {
  expect(startOfDay('2026-10-02', 'Asia/Ho_Chi_Minh')).toBe('2026-10-02T00:00:00+07:00');
  expect(startOfDay('2026-10-02', 'Asia/Kathmandu')).toBe('2026-10-02T00:00:00+05:45');
  expect(startOfDay('2026-01-02', 'Europe/Berlin')).toBe('2026-01-02T00:00:00+01:00');
  expect(startOfDay('2026-07-02', 'Europe/Berlin')).toBe('2026-07-02T00:00:00+02:00');
  expect(startOfDay('2026-10-02', 'UTC')).toBe('2026-10-02T00:00:00+00:00');
});

it('rejects invalid days, missing timezone and nonexistent or ambiguous local midnight', () => {
  expect(() => startOfDay('2026-02-30', 'Asia/Ho_Chi_Minh')).toThrow();
  expect(() => startOfDay('', 'Asia/Ho_Chi_Minh')).toThrow();
  expect(() => startOfDay('2026-10-02', '')).toThrow();
  expect(() => startOfDay('2011-12-30', 'Pacific/Apia')).toThrow();
  expect(() => startOfDay('2026-11-01', 'America/Havana')).toThrow();
});
