import type { Person, Role, WorkOrder, Roster, Craft } from './model';

const groups: Array<[Craft, number, number, number]> = [
  ['E&I', 17, 2, 2], ['MECH', 12, 2, 2], ['RES', 4, 0, 0], ['P&P', 17, 6, 0], ['DECK', 11, 2, 0],
];
export const syntheticPeople: Person[] = groups.flatMap(([craft, tech, sup, assistant]) => {
  const roles: Array<[Role, number]> = [['TECH', tech], ['SUP', sup], ['ASST_SUP', assistant],
    ['CONTROL_RM_ENGINEER', craft === 'P&P' ? 8 : 0], ['MATERIAL_CONTROLLER', craft === 'MECH' ? 2 : 0]];
  return roles.flatMap(([role, count]) => Array.from({ length: count }, (_, i) => ({
    id: `${craft.replace(/[^A-Z]/g, '')}-${role}-${i + 1}`,
    name: `${craft} ${role === 'CONTROL_RM_ENGINEER' ? 'Control RM Engineer' : role === 'MATERIAL_CONTROLLER' ? 'Material Controller' : role === 'ASST_SUP' ? 'Assistant' : role === 'SUP' ? 'Supervisor' : 'Technician'} ${String(i + 1).padStart(2, '0')}`,
    craft, role,
  })));
});
const crafts: Craft[] = ['E&I', 'MECH', 'RES', 'P&P', 'DECK'];
export const syntheticWorkOrders: WorkOrder[] = Array.from({ length: 200 }, (_, i) => {
  const craft = crafts[i % crafts.length];
  const sameNumber = i < 2;
  const wonum = sameNumber ? 'WO-41001' : `WO-${41002 + i}`;
  const site = i % 2 ? 'BD-2' : 'BD-1';
  const connection = i % 3 ? 'onshore-test' : 'offshore-test';
  const workorderid = `WID-${900000 + i}`;
  return { id: `${connection}:${site}:${workorderid}`, wonum, site, connection, workorderid, craft,
    description: `${['Inspect', 'Repair', 'Test', 'Replace', 'Service'][i % 5]} ${craft} equipment · synthetic`,
    demandMinutes: 630 * (1 + (i % 4)) };
});
export const initialRoster: Roster = { people: syntheticPeople, workOrders: syntheticWorkOrders, allocations: [
  { id: 'seed-1', personId: 'EI-TECH-1', workOrderId: syntheticWorkOrders[0].id, date: '2026-11-02', minutes: 360 },
  { id: 'seed-2', personId: 'EI-TECH-1', workOrderId: syntheticWorkOrders[5].id, date: '2026-11-02', minutes: 180 },
  { id: 'seed-3', personId: 'MECH-SUP-1', workOrderId: syntheticWorkOrders[1].id, date: '2026-11-01', minutes: 240 },
] };
