import { afterEach, expect, it, vi } from 'vitest';
import { deleteDraft, openBatch, prepareBatch, saveBatch, type BatchRow, type Detail, type DraftNotice } from '../api/drafts';
import { columns, RetrievalError, type PlanningMarker, type WorkOrder } from '../api/workOrders';
import { consolidateDrafts } from './consolidateDrafts';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), prepareBatch: vi.fn(), saveBatch: vi.fn(), openBatch: vi.fn(), deleteDraft: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const scope = { connection_id: 'one', discipline: 'MECH' };
const signal = new AbortController().signal;
const order = (id: string, drafts: PlanningMarker[]) => ({ ...Object.fromEntries(columns.map(([key]) => [key, null])), siteid: 'S', workorderid: id,
  wonum: `WO-${id}`, status: 'APPR', worktype: 'CM', bdpocdiscipline: 'MECH', targcompdate: '2026-12-31T00:00:00Z', wopriority: 0, drafts }) as WorkOrder;
const marker = (id: string, over: Partial<PlanningMarker> = {}): PlanningMarker => ({ draft_id: id, version: 1, is_batch: false,
  updated_at: '2026-10-06T09:00:00+07:00', baseline_changed: false, changes: { estdur: '9' }, ...over });
const detail = (id: string): Detail => ({ item: order(id, []), baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'],
  baseline: { worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: null, estdur: '8', targstartdate: null, targcompdate: null } });
const member = (id: string, changes: BatchRow['changes'] = { estdur: '9' }): BatchRow => ({ ...detail(id), changes, baseline_changed: false, changes_valid_now: true });
const saved = { draft_id: 'merged', version: 1, state: 'draft' as const };

function prepared() {
  vi.mocked(prepareBatch).mockImplementation(async (_scope, keys) => keys.map((key) => detail(key.workorder_id)));
  vi.mocked(saveBatch).mockResolvedValue(saved);
  vi.mocked(deleteDraft).mockResolvedValue();
}

it('reuses the only draft untouched when it is a single draft of the single drafted row', async () => {
  const result = await consolidateDrafts(scope, [order('1', [marker('only')]), order('2', [])], signal);
  expect(result).toEqual({ draftId: 'only', dropped: [], warnings: [] });
  expect(openBatch).not.toHaveBeenCalled();
  expect(saveBatch).not.toHaveBeenCalled();
});

it('reuses a group draft whose members are exactly the drafted rows', async () => {
  const group = marker('group', { is_batch: true, version: 3 });
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'group', version: 3, state: 'draft', items: [member('1'), member('2')] });
  const result = await consolidateDrafts(scope, [order('1', [group]), order('2', [group]), order('3', [])], signal);
  expect(result.draftId).toBe('group');
  expect(openBatch).toHaveBeenCalledWith('group', scope, signal);
  expect(saveBatch).not.toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
});

it('merges drafts into one new group and deletes the old ones only after it is saved', async () => {
  prepared();
  const notices: DraftNotice[] = [];
  const rows = [order('1', [marker('a')]), order('2', [marker('b', { version: 5 })])];
  const result = await consolidateDrafts(scope, rows, signal, (notice) => notices.push(notice));
  expect(result).toEqual({ draftId: 'merged', dropped: [], warnings: [] });
  expect(vi.mocked(saveBatch).mock.calls[0][1].map((row) => row.item.workorderid)).toEqual(['1', '2']);
  expect(vi.mocked(saveBatch).mock.calls[0][3]).toBeNull();
  const saveOrder = vi.mocked(saveBatch).mock.invocationCallOrder[0];
  expect(vi.mocked(deleteDraft).mock.calls.map(([draft]) => draft)).toEqual([
    { draft_id: 'a', version: 1, state: 'draft' }, { draft_id: 'b', version: 5, state: 'draft' }]);
  vi.mocked(deleteDraft).mock.invocationCallOrder.forEach((value) => expect(value).toBeGreaterThan(saveOrder));
  expect(notices.map((notice) => [notice.draft_id, notice.items === null])).toEqual([['merged', false], ['a', true], ['b', true]]);
});

it('keeps every member of a group draft, also those outside the loaded table', async () => {
  prepared();
  const group = marker('group', { is_batch: true, version: 3 });
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'group', version: 4, state: 'draft', items: [member('1'), member('9')] });
  await consolidateDrafts(scope, [order('1', [group]), order('2', [marker('single')])], signal);
  expect(vi.mocked(prepareBatch).mock.calls[0][1].map((key) => key.workorder_id).sort()).toEqual(['1', '2', '9']);
  // The group is deleted with the version that was just read, not the stale one of the table.
  expect(vi.mocked(deleteDraft).mock.calls.map(([draft]) => draft)).toContainEqual({ draft_id: 'group', version: 4, state: 'draft' });
});

it('lets the most recently updated draft win for a WO that is in several drafts', async () => {
  prepared();
  const older = marker('old', { updated_at: '2026-10-01T00:00:00Z', changes: { estdur: '5' } });
  const newer = marker('new', { updated_at: '2026-10-05T00:00:00Z', changes: { estdur: '7' } });
  await consolidateDrafts(scope, [order('1', [older, newer]), order('2', [marker('other')])], signal);
  const items = vi.mocked(saveBatch).mock.calls[0][1];
  expect(items).toHaveLength(2);
  expect(items.find((row) => row.item.workorderid === '1')?.changes).toEqual({ estdur: '7' });
  expect(vi.mocked(deleteDraft)).toHaveBeenCalledTimes(3);
});

it('drops fields that now equal Maximo or whose PIC is no longer allowed and reports emptied WOs', async () => {
  prepared();
  const rows = [
    order('1', [marker('a', { changes: { estdur: '8', assignedtechname: 'GONE' } })]),
    order('2', [marker('b', { changes: { estdur: '9', assignedtechname: 'GONE' } })]),
    order('3', [marker('c', { changes: { estdur: '10', assignedtechname: 'TECH' } })]),
  ];
  const result = await consolidateDrafts(scope, rows, signal);
  expect(result.dropped).toEqual(['WO-1']);
  const items = vi.mocked(saveBatch).mock.calls[0][1];
  expect(items.map((row) => [row.item.workorderid, row.changes])).toEqual([['2', { estdur: '9' }], ['3', { estdur: '10', assignedtechname: 'TECH' }]]);
  // The emptied WO's old draft is merged away as well.
  expect(deleteDraft).toHaveBeenCalledTimes(3);
});

it('refuses more than 200 WOs before saving or deleting anything', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => order(String(i), [marker(`d${i}`)]));
  await expect(consolidateDrafts(scope, rows, signal)).rejects.toThrow(/giới hạn 200 WO/);
  expect(prepareBatch).not.toHaveBeenCalled();
  expect(saveBatch).not.toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
});

it('deletes nothing when the new group cannot be saved', async () => {
  prepared();
  vi.mocked(saveBatch).mockRejectedValue(new RetrievalError(409, 'Đã đổi'));
  await expect(consolidateDrafts(scope, [order('1', [marker('a')]), order('2', [marker('b')])], signal)).rejects.toThrow('Đã đổi');
  expect(deleteDraft).not.toHaveBeenCalled();
});

it('keeps the old drafts when every change already equals Maximo', async () => {
  prepared();
  const rows = [order('1', [marker('a', { changes: { estdur: '8' } })]), order('2', [marker('b', { changes: { estdur: '8' } })])];
  await expect(consolidateDrafts(scope, rows, signal)).rejects.toThrow(/không còn gì để gửi/);
  expect(saveBatch).not.toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
});

it('keeps deleting after a failed delete and reports a warning', async () => {
  prepared();
  vi.mocked(deleteDraft).mockRejectedValueOnce(new RetrievalError(500, 'Máy chủ lỗi')).mockResolvedValue();
  const notices: DraftNotice[] = [];
  const result = await consolidateDrafts(scope, [order('1', [marker('a')]), order('2', [marker('b')])], signal, (notice) => notices.push(notice));
  expect(result.draftId).toBe('merged');
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain('Máy chủ lỗi');
  expect(deleteDraft).toHaveBeenCalledTimes(2);
  expect(notices.filter((notice) => notice.items === null).map((notice) => notice.draft_id)).toEqual(['b']);
});
