export type Craft = 'E&I' | 'MECH' | 'RES' | 'P&P' | 'DECK';
export type Role = 'TECH' | 'SUP' | 'ASST_SUP' | 'CONTROL_RM_ENGINEER' | 'MATERIAL_CONTROLLER';
export interface RotaPerson { id: string; row: number; name: string; position: string; craft: Craft; role: Role; days: Record<string, string>; }
export interface DefaultCraft { craft: string; isDefault: boolean; }
export interface LaborCandidate { connection: string; org: string; laborcode: string; name: string; active: boolean; defaultCrafts: DefaultCraft[]; }
export interface Scenario { id: string; label: string; fileName: string; sheet: string; coverage: string; revision: string; people: RotaPerson[]; labor: LaborCandidate[]; sourceErrors: string[]; }
export type Mapping = Record<number, string>;
export const bindingKey = (labor: LaborCandidate) => `${labor.connection}/${labor.org}/${labor.laborcode}`;
export const normalizeName = (name: string) => name.replace(/[Đđ]/g, char => char === 'Đ' ? 'D' : 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
export const effectiveCraft = (person: RotaPerson): Craft => person.role === 'CONTROL_RM_ENGINEER' ? 'P&P' : person.role === 'MATERIAL_CONTROLLER' ? 'MECH' : person.craft;
const WORK_CODES = new Set(['W', '1', 'OT', 'M', 'OM', 'A', 'AM']);
const OFF_CODES = new Set(['', 'OFF', 'R', 'X', '-', 'AF', 'D', 'DM', 'DF', 'F', 'AL', 'SL', 'PL', 'CL', 'O', 'O4', 'O5', 'O6', 'AB']);
export const dayCapacity = (code: string) => WORK_CODES.has(code.trim().toUpperCase()) ? 630 : OFF_CODES.has(code.trim().toUpperCase()) ? 0 : null;
export const formatCapacityHours = (minutes: number) => (minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
export function validateSource(scenario: Scenario): string[] {
  const errors = [...scenario.sourceErrors];
  const seenRows = new Set<number>(); const seenIds = new Set<string>();
  for (const person of scenario.people) {
    if (!person.id.trim() || seenIds.has(person.id)) errors.push(`Dòng ${person.row}: mã người nguồn bị trống hoặc trùng.`);
    if (seenRows.has(person.row)) errors.push(`Dòng ${person.row}: số dòng nguồn bị trùng.`);
    seenIds.add(person.id); seenRows.add(person.row);
    if (!person.name.trim() || !person.position.trim()) errors.push(`Dòng ${person.row}: thiếu tên hoặc chức danh nguồn.`);
    if ((person.role === 'CONTROL_RM_ENGINEER' && person.craft !== 'P&P') || (person.role === 'MATERIAL_CONTROLLER' && person.craft !== 'MECH')) errors.push(`Dòng ${person.row}: craft nguồn không khớp role (${person.role}). Sửa file rota.`);
    for (const [date, code] of Object.entries(person.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Dòng ${person.row}, cột ${date}: ngày không đúng dạng YYYY-MM-DD.`); continue; }
    const [year, month, day] = date.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) errors.push(`Dòng ${person.row}, cột ${date}: ngày không tồn tại.`);
    if (dayCapacity(code) === null) errors.push(`Dòng ${person.row}, ô ngày ${date}: mã rota “${code}” chưa được hỗ trợ; sửa file nguồn rồi tải lại.`);
    }
  }
  return [...new Set(errors)];
}
export function distinctDefaultCrafts(labor: LaborCandidate): string[] {
  return [...new Set(labor.defaultCrafts.filter(rate => rate.isDefault).map(rate => rate.craft.trim().toUpperCase()))];
}
export function candidatesFor(person: RotaPerson, people: RotaPerson[], labor: LaborCandidate[]): LaborCandidate[] {
  const inRotaNames = new Set(people.map(item => normalizeName(item.name)));
  return labor.filter(item => inRotaNames.has(normalizeName(item.name)) && normalizeName(item.name) === normalizeName(person.name));
}
export function initialMappings(scenario: Scenario): Mapping {
  const map: Mapping = {};
  scenario.people.forEach(person => {
    const candidates = candidatesFor(person, scenario.people, scenario.labor);
    const exact = candidates.filter(item => item.active && distinctDefaultCrafts(item).length === 1 && distinctDefaultCrafts(item)[0] === effectiveCraft(person).toUpperCase());
    if (exact.length === 1) map[person.row] = bindingKey(exact[0]);
  });
  return map;
}
export interface PersonIssue { row: number; kind: 'unmatched' | 'ambiguous' | 'inactive' | 'craft' | 'missing-craft' | 'multiple-craft' | 'duplicate'; message: string; }
export function analyze(scenario: Scenario, mappings: Mapping): PersonIssue[] {
  const issues: PersonIssue[] = [];
  const used = new Map<string, number>();
  for (const person of scenario.people) {
    const options = candidatesFor(person, scenario.people, scenario.labor);
    const selectedKey = mappings[person.row];
    if (!options.length) { issues.push({ row: person.row, kind: 'unmatched', message: 'Không tìm thấy LABOR trùng tên trong mẫu.' }); continue; }
    if (!selectedKey) { issues.push({ row: person.row, kind: options.length > 1 ? 'ambiguous' : 'unmatched', message: options.length > 1 ? `Có ${options.length} LABOR cùng tên; cần chọn đúng người.` : 'Chưa chọn LABOR.' }); continue; }
    const selected = options.find(item => bindingKey(item) === selectedKey);
    if (!selected) { issues.push({ row: person.row, kind: 'unmatched', message: 'Mapping cũ không còn hợp lệ; chọn lại LABOR.' }); continue; }
    const prior = used.get(selectedKey);
    if (prior !== undefined) issues.push({ row: person.row, kind: 'duplicate', message: `LABOR đã được gán ở dòng ${prior}; mỗi LABOR chỉ gắn với một người rota.` });
    else used.set(selectedKey, person.row);
    if (!selected.active) issues.push({ row: person.row, kind: 'inactive', message: 'LABOR không ACTIVE; cần xác minh trước khi kích hoạt.' });
    const crafts = distinctDefaultCrafts(selected);
    if (!crafts.length) issues.push({ row: person.row, kind: 'missing-craft', message: 'LABOR không có default craft.' });
    else if (crafts.length > 1) issues.push({ row: person.row, kind: 'multiple-craft', message: `Có nhiều default craft khác nhau (${crafts.join(', ')}).` });
    else if (crafts[0] !== effectiveCraft(person).toUpperCase()) issues.push({ row: person.row, kind: 'craft', message: `Craft Maximo ${crafts[0]} khác craft rota ${effectiveCraft(person)}.` });
  }
  return issues;
}
export function isReady(scenario: Scenario, mappings: Mapping) { return validateSource(scenario).length === 0 && analyze(scenario, mappings).length === 0; }
export function diffPeople(before: RotaPerson[], after: RotaPerson[], beforeBindings: Record<string, string> = {}, afterBindings: Record<string, string> = {}) {
  const oldById = new Map(before.map(item => [item.id, item]));
  const newById = new Map(after.map(item => [item.id, item]));
  const added = after.filter(item => !oldById.has(item.id)).length;
  const removed = before.filter(item => !newById.has(item.id)).length;
  let changed = 0;
  for (const item of after) {
    const old = oldById.get(item.id);
    if (old) {
      const dates = new Set([...Object.keys(old.days), ...Object.keys(item.days)]);
      const calendarChanged = [...dates].some(date => old.days[date] !== item.days[date]);
      if (old.name !== item.name || old.position !== item.position || effectiveCraft(old) !== effectiveCraft(item) || old.role !== item.role || calendarChanged || (beforeBindings[item.id] !== undefined && afterBindings[item.id] !== undefined && beforeBindings[item.id] !== afterBindings[item.id])) changed++;
    }
  }
  return { added, removed, changed };
}
export interface DiffDetail { id: string; name: string; kind: 'added' | 'removed' | 'changed'; details: string[]; }
export function diffDetails(before: RotaPerson[], after: RotaPerson[], beforeBindings: Record<string, string> = {}, afterBindings: Record<string, string> = {}): DiffDetail[] {
  const oldById = new Map(before.map(person => [person.id, person])); const newById = new Map(after.map(person => [person.id, person]));
  const rows: DiffDetail[] = [];
  for (const person of after) {
    const old = oldById.get(person.id);
    if (!old) { rows.push({ id: person.id, name: person.name, kind: 'added', details: [`Thêm ${effectiveCraft(person)} · ${person.role}`] }); continue; }
    const details: string[] = [];
    if (old.name !== person.name) details.push(`Tên: ${old.name} → ${person.name}`);
    if (old.position !== person.position) details.push(`Chức danh: ${old.position} → ${person.position}`);
    if (effectiveCraft(old) !== effectiveCraft(person)) details.push(`Craft: ${effectiveCraft(old)} → ${effectiveCraft(person)}`);
    if (old.role !== person.role) details.push(`Role: ${old.role} → ${person.role}`);
    if (beforeBindings[person.id] !== undefined && afterBindings[person.id] !== undefined && beforeBindings[person.id] !== afterBindings[person.id]) details.push(`LABOR: ${beforeBindings[person.id]} → ${afterBindings[person.id]}`);
    for (const date of new Set([...Object.keys(old.days), ...Object.keys(person.days)])) {
      const prior = dayCapacity(old.days[date] ?? '') ?? 0; const next = dayCapacity(person.days[date] ?? '') ?? 0;
      if (prior !== next) details.push(`${date}: ${formatCapacityHours(prior)} → ${formatCapacityHours(next)} giờ`);
    }
    if (details.length) rows.push({ id: person.id, name: person.name, kind: 'changed', details });
  }
  for (const person of before) if (!newById.has(person.id)) rows.push({ id: person.id, name: person.name, kind: 'removed', details: [`Bỏ khỏi roster ${effectiveCraft(person)} · ${person.role}`] });
  return rows;
}
