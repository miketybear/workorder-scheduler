import type { CapacityDay, ResourcePerson } from '../api/assignments';

export type EffectiveResourceDay = CapacityDay & Pick<ResourcePerson, 'craft' | 'role' | 'laborcode'>;

export function effectiveDays(rows: ResourcePerson[], personId: string): EffectiveResourceDay[] {
  const byDate = new Map<string, EffectiveResourceDay>();
  for (const person of rows) {
    if (person.person_id !== personId) continue;
    for (const day of person.days) {
      if (day.capacity_minutes > 0 && !byDate.has(day.date)) byDate.set(day.date, { ...day, craft: person.craft, role: person.role, laborcode: person.laborcode });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function poolMonthTotals(rows: ResourcePerson[]) {
  const perPersonDay = new Map<string, CapacityDay>();
  for (const person of rows) for (const day of person.days) perPersonDay.set(`${person.person_id}:${day.date}`, day);
  return [...perPersonDay.values()].reduce((sum, day) => ({
    allocated: sum.allocated + day.allocated_minutes,
    remaining: sum.remaining + day.remaining_minutes,
  }), { allocated: 0, remaining: 0 });
}

export function wouldExceedCapacity(day: CapacityDay | undefined, minutes: number, replacingMinutes = 0): boolean {
  return !day || minutes < 1 || minutes > 630 || day.allocated_minutes - replacingMinutes + minutes > day.capacity_minutes || day.capacity_minutes > 630;
}
