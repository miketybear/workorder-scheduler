import { expect, it } from 'vitest';
import { columns, type WorkOrder } from '../api/workOrders';
import { allConfirmed, chipText, localRouteCode, mergeFreshRows, reasonText, routeCategory, routeChips, resultDetail, routeFingerprint, SUMMARY_NEEDS_ATTENTION } from './routeRules';

const order = (overrides: Partial<WorkOrder> = {}) => ({ ...Object.fromEntries(columns.map(([field]) => [field, null])),
  siteid: 'BD1', wonum: 'P1', workorderid: '1', worktype: 'CM', status: 'SCHED', targcompdate: '2026-10-31T00:00:00+07:00', wopriority: 0,
  schedstart: '2026-10-26T06:30:00+07:00', schedfinish: '2026-10-26T13:00:00+07:00', assignedto: 'VIETLV', ...overrides }) as WorkOrder;

it('rules out locally exactly what the server would reject first, and leaves the rest to the server', () => {
  expect(localRouteCode(order())).toBeNull();
  expect(localRouteCode(order({ status: 'COMP' }))).toBe('status_not_routable');
  expect(localRouteCode(order({ schedfinish: null }))).toBe('missing_schedule');
  expect(localRouteCode(order({ assignedto: null }))).toBe('missing_assignee');
  const draft = { draft_id: 'd', version: 1, is_batch: false, updated_at: '2026-10-23T00:00:00Z', changes: {}, baseline_changed: false };
  expect(localRouteCode(order({ drafts: [draft], status: 'COMP' }))).toBe('not_synced');
});

it('changes the fingerprint whenever a readiness field changes', () => {
  const base = routeFingerprint(order());
  expect(routeFingerprint(order())).toBe(base);
  for (const change of [{ status: 'APPR' }, { schedstart: null }, { schedfinish: null }, { assignedto: 'X' }] as Partial<WorkOrder>[]) {
    expect(routeFingerprint(order(change))).not.toBe(base);
  }
});

it('has a reason for every code the server can give and falls back for unknown ones', () => {
  for (const code of ['not_synced', 'upload_pending', 'supervisor_missing', 'is_child', 'status_not_routable', 'missing_schedule', 'missing_assignee', 'no_workflow',
    'no_active_assignment', 'multiple_assignments', 'already_routed', 'contract_changed', 'out_of_scope']) expect(reasonText(code)).not.toBe('Chưa route được');
  expect(reasonText('something_new')).toBe('Chưa route được');
});

it('never summarises a mixed result as success and flags the states that need attention', () => {
  const item = (state: string, code: string | null = null) => ({ site_id: 'BD1', workorder_id: '1', wonum: 'P1', state, code, wfassignment_id_after: null, assigned_to: 'VIETLV' }) as never;
  expect(allConfirmed([item('confirmed'), item('confirmed')])).toBe(true);
  expect(allConfirmed([item('confirmed'), item('unknown')])).toBe(false);
  expect(allConfirmed([])).toBe(false);
  expect(SUMMARY_NEEDS_ATTENTION([item('confirmed'), item('stranded')])).toBe(true);
  expect(SUMMARY_NEEDS_ATTENTION([item('failed'), item('rejected')])).toBe(false);
  expect(resultDetail(item('confirmed'))).toBe('PIC VIETLV');
  expect(resultDetail(item('stranded', 'stranded_no_assignment'))).toMatch(/không tạo việc mới/);
  expect(resultDetail(item('not_attempted', 'previous_work_order_failed'))).toBe('Dừng vì WO trước đó.');
});

it('merges the data Maximo now reports into only the routed rows and keeps the app-side markers', () => {
  const draft = { draft_id: 'd', version: 1, is_batch: false, updated_at: '2026-10-26T00:00:00Z', changes: {}, baseline_changed: false };
  const a = order({ workorderid: '1', wonum: 'A', status: 'APPR', drafts: [draft] });
  const b = order({ workorderid: '2', wonum: 'B', status: 'APPR' });
  const merged = mergeFreshRows([a, b], [order({ workorderid: '1', wonum: 'A', status: 'SCHED', assignedto: 'NGOCNH' })]);
  expect(merged[0]).toMatchObject({ status: 'SCHED', assignedto: 'NGOCNH', drafts: [draft] });
  expect(merged[1]).toBe(b);
});

it('puts every row in one category and orders the chips by what can be acted on', () => {
  const info = (code: string, ready = false) => ({ fingerprint: 'x', ready, code, assigned_to: null, supervisor: null });
  const out = (state: string) => ({ site_id: 'BD1', workorder_id: '1', wonum: 'P1', state, code: null, wfassignment_id_after: null, assigned_to: null }) as never;
  expect(routeCategory(out('confirmed'), info('ready', true))).toBe('done');
  expect(routeCategory(undefined, info('already_routed'))).toBe('done');
  expect(routeCategory(out('stranded'), null)).toBe('stranded');
  expect(routeCategory(out('unknown'), null)).toBe('unknown');
  expect(routeCategory(undefined, null)).toBe('checking');
  expect(routeCategory(undefined, info('ready', true))).toBe('ready');
  expect(routeCategory(undefined, info('missing_schedule'))).toBe('missing_schedule');
  const chips = routeChips(['missing_schedule', 'missing_schedule', 'done', 'ready', 'upload_pending', 'missing_assignee', 'stranded', 'missing_schedule']);
  expect(chips.map((chip) => chip.category)).toEqual(['ready', 'upload_pending', 'done', 'stranded', 'missing_schedule', 'missing_assignee']);
  expect(chips[1].count).toBe(1);
  expect(chipText('upload_pending')).toBe('Upload chưa xong');
  // Workflow states the planner cannot act on get no chip; the row still shows the reason.
  expect(routeChips(['ready', 'no_active_assignment', 'no_workflow', 'is_child']).map((chip) => chip.category)).toEqual(['ready']);
  expect(chipText('missing_schedule')).toBe('Thiếu lịch');
  expect(chipText('something_new')).toBe('Chưa route được');
});
