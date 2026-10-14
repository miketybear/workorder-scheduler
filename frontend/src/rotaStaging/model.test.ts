import { describe, expect, it } from 'vitest';
import { scenarios } from './fixtures';
import { analyze, candidatesFor, dayCapacity, diffDetails, effectiveCraft, initialMappings, isReady, normalizeName, validateSource } from './model';

describe('rota staging model', () => {
  it('normalizes Vietnamese Đ and strips accents for candidate suggestions', () => {
    expect(normalizeName('Đỗ Thu Hà')).toBe(normalizeName('Do Thu Ha'));
  });
  it('only proposes labor whose normalized name occurs in the rota', () => {
    expect(scenarios[0].labor.find(item => item.laborcode === 'SYN-OLD-01')).toBeTruthy();
    expect(candidatesFor(scenarios[0].people[0], scenarios[0].people, scenarios[0].labor).map(item => item.laborcode)).toEqual(['SYN-EI-01']);
  });
  it('keeps support roles and applies the agreed special craft groups', () => {
    expect(effectiveCraft(scenarios[0].people[2])).toBe('P&P');
    expect(effectiveCraft(scenarios[0].people[3])).toBe('MECH');
    expect(scenarios[0].people.map(person => person.role)).toContain('ASST_SUP');
  });
  it('blocks unresolved ambiguous identities, while deduplicating repeated default rows for the same craft', () => {
    const scenario = scenarios[0]; const mappings = initialMappings(scenario);
    expect(analyze(scenario, mappings).some(issue => issue.kind === 'ambiguous')).toBe(true);
    expect(analyze(scenario, mappings).some(issue => issue.kind === 'multiple-craft')).toBe(false);
    expect(validateSource(scenario)).toEqual([]);
  });
  it('blocks binding one composite LABOR identity to two rota people', () => {
    const base = scenarios[0]; const duplicate = { ...base.people[0], id: 'P-BAO-DUP', row: 23 };
    const scenario = { ...base, people: [...base.people, duplicate] };
    expect(analyze(scenario, initialMappings(scenario)).some(issue => issue.kind === 'duplicate')).toBe(true);
  });
  it('treats working, blank and known absence codes correctly and blocks unknown codes or invalid dates', () => {
    expect(dayCapacity('W')).toBe(630); expect(dayCapacity('1')).toBe(630);
    for (const code of ['', 'AF', 'D', 'DM', 'DF', 'F', 'AL', 'SL', 'PL', 'CL', 'O', 'O4', 'O5', 'O6', 'AB']) expect(dayCapacity(code)).toBe(0);
    expect(dayCapacity('?')).toBeNull();
    const invalid = { ...scenarios[0], sourceErrors: [], people: [{ ...scenarios[0].people[0], days: { '2026-11-31': 'W', '2026-11-01': '?' } }] };
    expect(validateSource(invalid).join(' ')).toContain('ngày không tồn tại');
    expect(validateSource(invalid).join(' ')).toContain('mã rota');
    expect(isReady(invalid, {})).toBe(false);
  });
  it('shows per-person removals, additions and date capacity changes using stable person ids', () => {
    const before = [{ ...scenarios[0].people[0], days: { '2026-11-01': 'W' } }];
    const after = [{ ...before[0], days: { '2026-11-01': 'AF' } }, { ...scenarios[0].people[1], id: 'NEW' }];
    const details = diffDetails(before, after);
    expect(details.find(row => row.id === before[0].id)?.details).toContain('2026-11-01: 10,5 → 0 giờ');
    expect(details.find(row => row.id === 'NEW')?.kind).toBe('added');
  });
});
