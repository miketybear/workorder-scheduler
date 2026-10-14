import type { LaborCandidate, RotaPerson, Scenario } from './model';

const days = (a: string, b = 'W') => ({ '2026-11-01': a, '2026-11-02': b, '2026-11-03': '' });
const people: RotaPerson[] = [
  { id: 'P-BAO', row: 17, name: 'Pham Gia Bao', position: 'E&I Technician', craft: 'E&I', role: 'TECH', days: days('1') },
  { id: 'P-AN', row: 18, name: 'Le Minh An', position: 'E&I Supervisor', craft: 'E&I', role: 'SUP', days: days('W', 'AL') },
  { id: 'P-LINH', row: 19, name: 'Nguyen Ha Linh', position: 'Control RM Engineer', craft: 'P&P', role: 'CONTROL_RM_ENGINEER', days: days('W') },
  { id: 'P-MINH', row: 20, name: 'Tran Quoc Minh', position: 'Material Controller', craft: 'MECH', role: 'MATERIAL_CONTROLLER', days: days('W') },
  { id: 'P-HA', row: 21, name: 'Do Thu Ha', position: 'Assistant RES Supervisor', craft: 'RES', role: 'ASST_SUP', days: days('W') },
];
const labor: LaborCandidate[] = [
  { connection: 'onshore-test', org: 'BDPOC', laborcode: 'SYN-EI-01', name: 'Pham Gia Bao', active: true, defaultCrafts: [{ craft: 'E&I', isDefault: true }] },
  { connection: 'onshore-test', org: 'BDPOC', laborcode: 'SYN-EI-02', name: 'Le Minh An', active: true, defaultCrafts: [{ craft: 'E&I', isDefault: true }] },
  { connection: 'offshore-test', org: 'BDPOC', laborcode: 'SYN-EI-03', name: 'Le Minh An', active: true, defaultCrafts: [{ craft: 'E&I', isDefault: true }] },
  { connection: 'onshore-test', org: 'BDPOC', laborcode: 'SYN-CR-01', name: 'Nguyen Ha Linh', active: true, defaultCrafts: [{ craft: 'P&P', isDefault: true }, { craft: 'P&P', isDefault: true }] },
  { connection: 'onshore-test', org: 'BDPOC', laborcode: 'SYN-MC-01', name: 'Tran Quoc Minh', active: true, defaultCrafts: [{ craft: 'MECH', isDefault: true }] },
  { connection: 'onshore-test', org: 'BDPOC', laborcode: 'SYN-RES-01', name: 'Do Thu Ha', active: true, defaultCrafts: [{ craft: 'RES', isDefault: true }] },
  { connection: 'onshore-test', org: 'BDPOC', laborcode: 'SYN-OLD-01', name: 'Ngoai Rota', active: true, defaultCrafts: [{ craft: 'MECH', isDefault: true }] },
];
const base = { fileName: 'rota-demo.xlsx', sheet: 'ROTA_2026', coverage: '01–03/11/2026 (mẫu 3 ngày)', revision: 'R03 · toàn bộ roster mẫu', people, labor };
export const scenarios: Scenario[] = [
  { ...base, id: 'valid', label: 'Mẫu có mapping mơ hồ', sourceErrors: [] },
  { ...base, id: 'unmatched', label: 'Mẫu thiếu LABOR', fileName: 'rota-demo-r04.xlsx', revision: 'R04 · ví dụ thiếu mapping', people: [...people, { id: 'P-LONG', row: 22, name: 'Vu Duc Long', position: 'RES Technician', craft: 'RES', role: 'TECH', days: days('W') }], sourceErrors: [] },
  { ...base, id: 'invalid', label: 'Mẫu có lỗi ô ngày', revision: 'R05 · ví dụ dữ liệu nguồn lỗi', sourceErrors: ['Sheet ROTA_2026, ô NH4: ngày không hợp lệ (31/11/2026). Sửa file nguồn rồi tải lại.'] },
];

export const activeRoster: RotaPerson[] = [
  { id: 'P-BAO', row: 10, name: 'Pham Gia Bao', position: 'E&I Technician', craft: 'E&I', role: 'TECH', days: days('W') },
  { id: 'P-OLD', row: 11, name: 'Old RES Technician', craft: 'RES', position: 'RES Technician', role: 'TECH', days: days('W') },
];
