import { expect, it } from 'vitest';
import { effectiveDays, poolMonthTotals, wouldExceedCapacity } from './capacity';
import type { ResourcePerson } from '../api/assignments';

const person = (craft: string, role: string, days: ResourcePerson['days']): ResourcePerson => ({ person_id: 'same-person', name: 'Planner', craft, role, laborcode: 'L1', days });
const day = (date: string, allocated_minutes: number, remaining_minutes: number) => ({ date, code: '', capacity_minutes: 630, allocated_minutes, remaining_minutes });

it('keeps effective craft and role rows for the dates they cover without duplicating the person', () => {
  const rows = [person('E&I', 'TECH', [day('2026-10-01', 300, 330)]), person('MECH', 'SUP', [day('2026-10-02', 60, 570)])];
  expect(effectiveDays(rows, 'same-person')).toMatchObject([
    { date: '2026-10-01', craft: 'E&I', role: 'TECH' }, { date: '2026-10-02', craft: 'MECH', role: 'SUP' },
  ]);
  expect(poolMonthTotals(rows)).toEqual({ allocated: 360, remaining: 900 });
});

it('enforces integer-minute daily capacity up to 630 minutes and permits a replacement edit', () => {
  const current = day('2026-10-01', 600, 30);
  expect(wouldExceedCapacity(current, 31)).toBe(true);
  expect(wouldExceedCapacity(current, 630, 600)).toBe(false);
  expect(wouldExceedCapacity(current, 631)).toBe(true);
});
