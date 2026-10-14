export type Craft = 'E&I' | 'MECH' | 'RES' | 'P&P' | 'DECK';
export type Role = 'TECH' | 'SUP' | 'ASST_SUP' | 'CONTROL_RM_ENGINEER' | 'MATERIAL_CONTROLLER';
export type Availability = 'working' | 'off' | 'blank' | 'unknown';
export interface Person { id: string; name: string; craft: Craft; role: Role; }
export interface WorkOrder { id: string; wonum: string; site: string; connection: string; workorderid: string; craft: Craft; description: string; demandMinutes: number; }
export interface Allocation { id: string; personId: string; workOrderId: string; date: string; minutes: number; }
export interface Roster { people: Person[]; workOrders: WorkOrder[]; allocations: Allocation[]; }
export const CRAFTS: Craft[] = ['E&I', 'MECH', 'RES', 'P&P', 'DECK'];
export const ROLES: Role[] = ['TECH', 'SUP', 'ASST_SUP', 'CONTROL_RM_ENGINEER', 'MATERIAL_CONTROLLER'];
export const DAILY_CAPACITY = 630;
export const monthDays = (month: string): string[] => {
  const [year, m] = month.split('-').map(Number);
  if (!year || m < 1 || m > 12 || month !== `${year}-${String(m).padStart(2, '0')}`) return [];
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};
export const dateMinutes = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.getUTCDay() : -1;
};
export function availability(personId: string, date: string): Availability {
  const weekday = dateMinutes(date);
  if (weekday < 0) return 'unknown';
  // Synthetic rota: predictable working/off/blank states, with no source workbook data.
  const seed = [...personId].reduce((n, c) => n + c.charCodeAt(0), 0);
  const day = Number(date.slice(-2));
  if ((seed + day) % 19 === 0) return 'blank';
  if ((seed + day) % 7 === 0) return 'off';
  return 'working';
}
export const resourceCapacity = (personId: string, date: string): number => availability(personId, date) === 'working' ? DAILY_CAPACITY : 0;
export function usedMinutes(roster: Roster, personId: string, date: string, excludingId?: string): number {
  return roster.allocations.filter(a => a.personId === personId && a.date === date && a.id !== excludingId).reduce((sum, a) => sum + a.minutes, 0);
}
export function validateAllocation(roster: Roster, allocation: Allocation, excludingId?: string): string | null {
  const person = roster.people.find(p => p.id === allocation.personId);
  const wo = roster.workOrders.find(w => w.id === allocation.workOrderId);
  if (!person || !wo) return 'Chọn nhân sự và WO hợp lệ.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(allocation.date) || dateMinutes(allocation.date) < 0) return 'Ngày không hợp lệ.';
  if (wo.craft !== person.craft) return 'Craft của nhân sự phải khớp craft yêu cầu của WO.';
  if (!Number.isInteger(allocation.minutes) || allocation.minutes <= 0) return 'Giờ phải lớn hơn 0 và chính xác đến phút.';
  const capacity = resourceCapacity(person.id, allocation.date);
  if (!capacity) return 'Ngày này không có capacity rota khả dụng.';
  if (usedMinutes(roster, person.id, allocation.date, excludingId) + allocation.minutes > capacity) return 'Vượt quá 10,5 giờ/người/ngày.';
  const already = roster.allocations.filter(a => a.workOrderId === wo.id && a.id !== excludingId).reduce((n, a) => n + a.minutes, 0);
  if (already + allocation.minutes > wo.demandMinutes) return 'Vượt quá nhu cầu giờ còn lại của WO.';
  return null;
}
export function addAllocation(roster: Roster, allocation: Allocation): { roster: Roster; error: string | null } {
  if (roster.allocations.some(a => a.id === allocation.id)) return { roster, error: 'Mã phân bổ đã tồn tại.' };
  const error = validateAllocation(roster, allocation);
  return error ? { roster, error } : { roster: { ...roster, allocations: [...roster.allocations, allocation] }, error: null };
}
export function updateAllocation(roster: Roster, allocation: Allocation): { roster: Roster; error: string | null } {
  if (!roster.allocations.some(a => a.id === allocation.id)) return { roster, error: 'Phân bổ không còn tồn tại.' };
  const error = validateAllocation(roster, allocation, allocation.id);
  return error ? { roster, error } : { roster: { ...roster, allocations: roster.allocations.map(a => a.id === allocation.id ? allocation : a) }, error: null };
}
export const removeAllocation = (roster: Roster, id: string): Roster => ({ ...roster, allocations: roster.allocations.filter(a => a.id !== id) });
