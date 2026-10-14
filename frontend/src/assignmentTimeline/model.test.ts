import { describe, expect, it } from 'vitest';
import { initialRoster, syntheticPeople, syntheticWorkOrders } from './fixtures';
import { addAllocation, availability, monthDays, resourceCapacity, updateAllocation, usedMinutes, type Allocation, type Roster } from './model';

const workingDay = (personId: string) => monthDays('2026-11').find(d => availability(personId, d) === 'working')!;
const allocation = (id: string, personId: string, workOrderId: string, date: string, minutes: number): Allocation => ({ id, personId, workOrderId, date, minutes });

describe('assignment timeline pure model', () => {
  it('validates every initial allocation and keeps working Sundays available', () => {
    for (const item of initialRoster.allocations) {
      const baseline = { ...initialRoster, allocations: initialRoster.allocations.filter(a => a.id !== item.id) };
      expect(addAllocation(baseline, item).error).toBeNull();
    }
    expect(resourceCapacity('EI-SUP-1', '2026-11-01')).toBe(630);
  });

  it('rejects invalid dates, hours, crafts and known off days without changing state', () => {
    const person = 'EI-TECH-1';
    const baseline = { ...initialRoster, allocations: [] };
    const good = allocation('sample', person, syntheticWorkOrders[0].id, workingDay(person), 60);
    const off = monthDays('2026-11').find(d => availability(person, d) === 'off')!;
    for (const item of [
      { ...good, date: '2026-02-30' }, { ...good, date: off },
      { ...good, minutes: 0 }, { ...good, minutes: -1 },
      { ...good, minutes: 60.5 }, { ...good, minutes: Number.NaN },
      { ...good, workOrderId: syntheticWorkOrders[1].id },
    ]) {
      const result = addAllocation(baseline, item);
      expect(result.error).toBeTruthy();
      expect(result.roster).toBe(baseline);
    }
  });
  it('allows 6h + 4.5h and rejects 6h + 5h for one person-day', () => {
    const person = 'EI-TECH-1'; const date = workingDay(person); const wo1 = syntheticWorkOrders[0].id; const wo2 = syntheticWorkOrders[5].id;
    let roster: Roster = { ...initialRoster, allocations: [] };
    const six = addAllocation(roster, allocation('a', person, wo1, date, 360)); expect(six.error).toBeNull(); roster = six.roster;
    expect(addAllocation(roster, allocation('b', person, wo2, date, 270)).error).toBeNull();
    const five = addAllocation(roster, allocation('c', person, wo2, date, 300)); expect(five.error).toMatch(/10,5/); expect(five.roster).toBe(roster);
  });

  it('uses one shared person budget across WO sites and connections', () => {
    const date = workingDay('EI-TECH-1'); const [one, two] = [syntheticWorkOrders[0], syntheticWorkOrders[5]];
    expect(one.site).not.toBe(two.site); expect(one.connection).not.toBe(two.connection);
    let roster: Roster = { ...initialRoster, allocations: [] };
    roster = addAllocation(roster, allocation('a', 'EI-TECH-1', one.id, date, 360)).roster;
    expect(addAllocation(roster, allocation('b', 'EI-TECH-1', two.id, date, 270)).error).toBeNull();
    expect(addAllocation(roster, allocation('c', 'EI-TECH-1', two.id, date, 300)).error).toBeTruthy();
  });

  it('supports SUP and Assistant SUP with the same individual daily budget', () => {
    const date = workingDay('EI-SUP-1'); const workOrder = syntheticWorkOrders[0].id;
    for (const id of ['EI-SUP-1', 'EI-ASST_SUP-1']) {
      expect(syntheticPeople.find(p => p.id === id)?.role).toMatch(/SUP/);
      expect(resourceCapacity(id, date)).toBe(630);
      const result = addAllocation({ ...initialRoster, allocations: [] }, allocation(`support-${id}`, id, workOrder, date, 630));
      expect(result.error).toBeNull();
    }
  });

  it('rejects blank rota days and resources outside the eligible roster', () => {
    const person = syntheticPeople[0]; const blank = monthDays('2026-11').find(d => availability(person.id, d) === 'blank')!;
    const blankResult = addAllocation({ ...initialRoster, allocations: [] }, allocation('blank', person.id, syntheticWorkOrders[0].id, blank, 60));
    expect(blankResult.error).toMatch(/capacity/); expect(blankResult.roster.allocations).toHaveLength(0);
    const absent = addAllocation(initialRoster, allocation('absent', 'not-in-rota', syntheticWorkOrders[0].id, workingDay(person.id), 60));
    expect(absent.error).toMatch(/hợp lệ/); expect(syntheticPeople).toHaveLength(87);
  });

  it('includes control room engineers in P&P and material controllers in MECH without counting them as TECH', () => {
    for (const [role, craft, count] of [['CONTROL_RM_ENGINEER', 'P&P', 8], ['MATERIAL_CONTROLLER', 'MECH', 2]] as const) {
      const people = syntheticPeople.filter(p => p.role === role);
      expect(people).toHaveLength(count);
      expect(people.every(p => p.craft === craft)).toBe(true);
      const person = people[0];
      const date = workingDay(person.id);
      const wo = syntheticWorkOrders.find(w => w.craft === craft)!;
      expect(resourceCapacity(person.id, date)).toBe(630);
      const result = addAllocation({ ...initialRoster, allocations: [] }, allocation(role, person.id, wo.id, date, 630));
      expect(result.error).toBeNull();
      expect(addAllocation(result.roster, allocation(`${role}-overflow`, person.id, wo.id, date, 1)).error).toMatch(/10,5/);
    }
  });

  it('handles month lengths/leap years and keeps allocations outside the current view', () => {
    expect(monthDays('2026-11')).toHaveLength(30); expect(monthDays('2026-02')).toHaveLength(28); expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-13')).toHaveLength(0);
    expect(initialRoster.allocations.some(a => a.date === '2026-11-01')).toBe(true);
    expect(initialRoster.allocations.some(a => a.date === '2026-11-02')).toBe(true);
  });

  it('keys same WONUM records by composite identity', () => {
    const [first, second] = syntheticWorkOrders;
    expect(first.wonum).toBe(second.wonum); expect(first.id).not.toBe(second.id); expect(first.site).not.toBe(second.site);
  });

  it('rejects invalid update atomically and blocks duplicate allocation IDs', () => {
    const person = 'EI-TECH-1'; const date = workingDay(person); const wo1 = syntheticWorkOrders[0].id; const wo2 = syntheticWorkOrders[5].id;
    let roster: Roster = { ...initialRoster, allocations: [] };
    roster = addAllocation(roster, allocation('first', person, wo1, date, 360)).roster;
    roster = addAllocation(roster, allocation('second', person, wo2, date, 240)).roster;
    const rejected = updateAllocation(roster, allocation('first', person, wo1, date, 400));
    expect(rejected.error).toBeTruthy(); expect(rejected.roster).toBe(roster); expect(rejected.roster.allocations[0].minutes).toBe(360);
    expect(addAllocation(roster, allocation('first', person, wo1, date, 60)).error).toMatch(/tồn tại/);
  });

  it('moves hours between days atomically and releases only the old allocation', () => {
    const person = 'EI-TECH-1';
    const [source, target] = monthDays('2026-11').filter(day => availability(person, day) === 'working');
    const one = allocation('move', person, syntheticWorkOrders[0].id, source, 360);
    const two = allocation('keep', person, syntheticWorkOrders[5].id, target, 300);
    const baseline = { ...initialRoster, allocations: [one, two] };
    const rejected = updateAllocation(baseline, { ...one, date: target });
    expect(rejected.error).toMatch(/10,5/);
    expect(rejected.roster).toBe(baseline);
    const accepted = updateAllocation(baseline, { ...one, date: target, minutes: 270 });
    expect(accepted.error).toBeNull();
    expect(usedMinutes(accepted.roster, person, source)).toBe(0);
    expect(usedMinutes(accepted.roster, person, target)).toBe(570);
    expect(accepted.roster.allocations.find(item => item.id === 'keep')).toEqual(two);
  });
});
