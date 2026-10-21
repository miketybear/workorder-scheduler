import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BatchPlanner } from './BatchPlanner';
import { BatchError, deleteDraft, openBatch, prepareBatch, previewUpload, saveBatch, type Detail } from '../api/drafts';
import { columns, RetrievalError, type WorkOrder } from '../api/workOrders';
import { zonedDateTime } from '../api/dates';
import { getDateTime, groupControl, setDateTime } from '../testDateTime';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), prepareBatch: vi.fn(), saveBatch: vi.fn(), openBatch: vi.fn(), deleteDraft: vi.fn(), previewUpload: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const scope = { connection_id: 'one', discipline: 'MECH' };
const details: Detail[] = ['100', '101'].map((id) => ({
  item: { ...Object.fromEntries(columns.map(([key]) => [key, null])), siteid: 'BD1', workorderid: id,
    wonum: `WO-${id}`, systemid: 'MT1-61-INSTR-AIR-SYS', status: 'APPR', worktype: 'CM', bdpocdiscipline: 'MECH' } as WorkOrder,
  baseline_token: 'a'.repeat(64), allowed_pics: ['TECH', 'OTHER'], baseline: {
    worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: 'TECH', estdur: '8', targstartdate: null, targcompdate: null,
  },
}));
const props = { scope, selection: { keys: details.map(({ item }) => ({ site_id: item.siteid, workorder_id: item.workorderid })) },
  timezone: 'Asia/Ho_Chi_Minh', writable: true, suspended: false, onDirty: vi.fn(), onDenied: vi.fn(), onClose: vi.fn() };
async function setup() {
  vi.mocked(prepareBatch).mockResolvedValue(details);
  render(<BatchPlanner {...props} />);
  await screen.findByLabelText('WO-100 Est. Duration');
}

it('shows only supplemental facts with timezone-aware dates outside the editable row', async () => {
  vi.mocked(prepareBatch).mockResolvedValue(details.map((row) => ({ ...row, item: { ...row.item,
    wolo10: '25', wopriority_description: 'High', wopriority: 3, lead: 'ONSHORE',
    description: 'Repair pump', location: 'TAG-1', targstartdate: '2026-10-01T01:00:00Z',
    targcompdate: '2026-10-31T10:00:00Z', actstart: '2026-10-02T02:30:00Z',
  } })));
  render(<BatchPlanner {...props} />);
  const toggle = await screen.findByRole('button', { name: 'Thông tin WO-100' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  const info = screen.getByRole('region', { name: 'Thông tin bổ sung WO-100' });
  expect(toggle).toHaveAttribute('aria-controls', info.id);
  expect(info.closest('td')).toHaveAttribute('colspan', '8');
  const facts = within(info);
  expect(facts.getAllByRole('heading')).toHaveLength(3);
  for (const value of ['High (3)', 'ONSHORE', '25%', '01/10/2026, 08:00', '31/10/2026, 17:00', '02/10/2026, 09:30']) {
    expect(facts.getByText(value)).toBeInTheDocument();
  }
  for (const label of ['Work Order', 'Description', 'Work Type', 'Status', 'Tag Name', 'Discipline',
    'Scheduled Start', 'Scheduled Finish', 'Assigned PIC', 'Est. Duration']) {
    expect(facts.queryByText(label)).not.toBeInTheDocument();
  }
  expect(facts.queryByText('Repair pump')).not.toBeInTheDocument();
  expect(screen.getAllByText('Repair pump')).toHaveLength(2);
});

it('opens one supplementary row at a time and preserves edits without retrieving again', async () => {
  await setup();
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  const first = screen.getByRole('button', { name: 'Thông tin WO-100' });
  const second = screen.getByRole('button', { name: 'Thông tin WO-101' });
  fireEvent.click(first);
  fireEvent.click(second);
  expect(first).toHaveAttribute('aria-expanded', 'false');
  expect(second).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('region', { name: 'Thông tin bổ sung WO-100' })).not.toBeInTheDocument();
  fireEvent.click(second);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('9');
  expect(prepareBatch).toHaveBeenCalledTimes(1);
  expect(props.onDirty).toHaveBeenLastCalledWith(true);
});

it('applies group duration, supports undo, and requires preview before atomic save', async () => {
  await setup();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Est. Duration' }));
  fireEvent.change(screen.getByLabelText('Nhóm Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  expect(screen.getByLabelText('WO-101 Est. Duration')).toHaveValue('9');
  expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
  fireEvent.click(screen.getByText('Undo'));
  expect(screen.getByLabelText('WO-101 Est. Duration')).toHaveValue('8');
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockResolvedValue({ draft_id: 'group', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 2 WO. Maximo chưa thay đổi.');
  expect(vi.mocked(saveBatch).mock.calls[0][1]).toHaveLength(2);
  await vi.waitFor(() => expect(props.onDirty).toHaveBeenLastCalledWith(false));
});

it('shows per-WO containment errors and blocks batch save when a row exceeds Target Finish', async () => {
  const bounded = [{ ...details[0], baseline: { ...details[0].baseline,
    schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-05T16:00:00+07:00', estdur: '8',
    targstartdate: '2026-10-05T08:00:00+07:00', targcompdate: '2026-10-05T16:00:00+07:00' } }];
  vi.mocked(prepareBatch).mockResolvedValue(bounded);
  render(<BatchPlanner {...props} selection={{ keys: [{ site_id: bounded[0].item.siteid, workorder_id: bounded[0].item.workorderid }] }} />);
  fireEvent.change(await screen.findByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  expect(screen.getByRole('alert')).toHaveTextContent(/Scheduled Finish .* vượt Target Finish/);
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
  expect(saveBatch).not.toHaveBeenCalled();
});

it('validates group duration overflow per WO and rejects paste atomically when one row violates Target Start', async () => {
  const bounded = details.map((detail) => ({ ...detail, baseline: { ...detail.baseline,
    schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-05T16:00:00+07:00', estdur: '8',
    targstartdate: '2026-10-05T08:00:00+07:00', targcompdate: '2026-10-05T16:00:00+07:00' } }));
  vi.mocked(prepareBatch).mockResolvedValue(bounded);
  const view = render(<BatchPlanner {...props} />);
  await screen.findByLabelText('WO-100 Est. Duration');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Est. Duration' }));
  fireEvent.change(screen.getByLabelText('Nhóm Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  expect(screen.getAllByRole('alert').filter((entry) => entry.textContent?.includes('Scheduled Finish'))).toHaveLength(2);
  expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
  view.unmount();

  vi.mocked(prepareBatch).mockResolvedValue(bounded);
  render(<BatchPlanner {...props} />);
  await screen.findByLabelText('WO-100 Est. Duration');
  const paste = screen.getByLabelText('Vùng dữ liệu Excel');
  fireEvent.change(paste, { target: { value: '2026-10-05T08:00\t\t8\n2026-10-05T07:59\t\t8' } });
  fireEvent.click(screen.getByText('Kiểm tra và áp dữ liệu dán'));
  expect(screen.getByRole('alert')).toHaveTextContent('WO-101: Scheduled Start');
  expect(getDateTime(screen.getByLabelText('WO-100 Scheduled Start'))).toBe('2026-10-05T08:00');
  expect(getDateTime(screen.getByLabelText('WO-101 Scheduled Start'))).toBe('2026-10-05T08:00');
  expect(saveBatch).not.toHaveBeenCalled();
});

it('keeps PM and CFT targets disabled in a mixed batch and saves allowed row targets with explicit intent', async () => {
  const mixed = ['PM', 'CFT', 'CM'].map((worktype, index) => ({ ...details[index % details.length],
    item: { ...details[index % details.length].item, workorderid: String(100 + index), wonum: `WO-${100 + index}`, worktype },
    baseline: { ...details[index % details.length].baseline, worktype,
      targstartdate: '2026-10-01T08:00:00+07:00', targcompdate: '2026-10-02T08:00:00+07:00' },
  }));
  vi.mocked(prepareBatch).mockResolvedValue(mixed);
  render(<BatchPlanner {...props} selection={{ keys: mixed.map(({ item }) => ({ site_id: item.siteid, workorder_id: item.workorderid })) }} />);
  const pmTarget = await screen.findByLabelText('WO-100 Target Start');
  expect(groupControl(pmTarget)).toBeDisabled();
  expect(groupControl(screen.getByLabelText('WO-101 Target Finish'))).toBeDisabled();
  expect(screen.getAllByText('PM/CFT không được đổi Target.')).toHaveLength(4);
  expect(screen.getByLabelText('WO-102 Target Finish')).toBeEnabled();
  setDateTime(pmTarget, '2026-10-03T08:00');
  setDateTime(screen.getByLabelText('WO-101 Target Finish'), '2026-10-03T08:00');
  setDateTime(screen.getByLabelText('WO-102 Target Finish'), '2026-10-05T09:30');
  expect(getDateTime(screen.getByLabelText('WO-100 Target Start'))).toBe('2026-10-01T08:00');
  expect(getDateTime(screen.getByLabelText('WO-101 Target Finish'))).toBe('2026-10-02T08:00');
  expect(getDateTime(screen.getByLabelText('WO-102 Target Finish'))).toBe('2026-10-05T09:30');
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockResolvedValue({ draft_id: 'target-batch', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 1 WO. Maximo chưa thay đổi.');
  expect(vi.mocked(saveBatch).mock.calls[0][1]).toHaveLength(1);
  expect(vi.mocked(saveBatch).mock.calls[0][1][0].changes).toEqual({
    targcompdate: '2026-10-05T09:30:00+07:00', change_target: true,
  });
});

it('restores permitted target proposals to their non-null row baseline and undo restores the proposal', async () => {
  const row = { ...details[0], baseline: { ...details[0].baseline, targstartdate: '2026-10-01T08:00:00+07:00' } };
  vi.mocked(prepareBatch).mockResolvedValue([row]);
  render(<BatchPlanner {...props} selection={{ keys: [{ site_id: row.item.siteid, workorder_id: row.item.workorderid }] }} />);
  const start = await screen.findByLabelText('WO-100 Target Start');
  setDateTime(start, '2026-10-03T09:00');
  expect(getDateTime(start)).toBe('2026-10-03T09:00');
  // The date and the hour are separate edits: undo until the history is empty.
  for (let step = 0; step < 4 && !(screen.getByText('Undo') as HTMLButtonElement).disabled; step++) fireEvent.click(screen.getByText('Undo'));
  expect(getDateTime(start)).toBe('2026-10-01T08:00');
  setDateTime(start, '2026-10-04T09:00');
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục Target gốc' }));
  expect(getDateTime(start)).toBe('2026-10-01T08:00');
  expect(screen.queryByRole('button', { name: 'Khôi phục Target gốc' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Undo'));
  expect(getDateTime(screen.getByLabelText('WO-100 Target Start'))).toBe('2026-10-04T09:00');
});

it('drops allowed target no-ops and their intent while retaining PM/CFT duration rows in the atomic save', async () => {
  const mixed = ['PM', 'CFT', 'CM', 'General'].map((worktype, index) => ({ ...details[index % details.length],
    item: { ...details[index % details.length].item, workorderid: String(200 + index), wonum: `WO-${200 + index}`, worktype },
    baseline: { ...details[index % details.length].baseline, worktype,
      targstartdate: '2026-10-01T08:00:00+07:00', targcompdate: '2026-10-02T08:00:00+07:00' },
  }));
  vi.mocked(prepareBatch).mockResolvedValue(mixed);
  render(<BatchPlanner {...props} selection={{ keys: mixed.map(({ item }) => ({ site_id: item.siteid, workorder_id: item.workorderid })) }} />);
  fireEvent.change(await screen.findByLabelText('WO-200 Est. Duration'), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText('WO-201 Est. Duration'), { target: { value: '10' } });
  for (const wonum of ['WO-202', 'WO-203']) {
    setDateTime(screen.getByLabelText(`${wonum} Target Start`), '2026-10-03T08:00');
    setDateTime(screen.getByLabelText(`${wonum} Target Finish`), '2026-10-04T08:00');
    setDateTime(screen.getByLabelText(`${wonum} Target Start`), '2026-10-01T08:00');
    setDateTime(screen.getByLabelText(`${wonum} Target Finish`), '2026-10-02T08:00');
  }
  expect(screen.queryByRole('button', { name: 'Khôi phục Target gốc' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockResolvedValue({ draft_id: 'duration-only-pm-cft', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 2 WO. Maximo chưa thay đổi.');
  const items = vi.mocked(saveBatch).mock.calls[0][1];
  expect(items.map((item) => item.item.worktype)).toEqual(['PM', 'CFT']);
  expect(items.map((item) => item.changes)).toEqual([{ estdur: '9' }, { estdur: '10' }]);
});

it('warns per PM row for a duration-derived finish while a CM calendar edit stays unflagged', async () => {
  const rows = details.map((detail, index) => ({ ...detail, item: { ...detail.item, worktype: index === 0 ? 'PM' : 'CM',
    schedstart: '2026-10-01T08:00:00+07:00', schedfinish: '2026-10-01T16:00:00+07:00' }, baseline: { ...detail.baseline,
    worktype: index === 0 ? 'PM' : 'CM', schedstart: '2026-10-01T08:00:00+07:00', schedfinish: '2026-10-01T16:00:00+07:00' } }));
  vi.mocked(prepareBatch).mockResolvedValue(rows);
  render(<BatchPlanner {...props} />);
  await screen.findByLabelText('WO-100 Est. Duration');
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  setDateTime(screen.getByLabelText('WO-101 Scheduled Start'), '2026-10-01T09:00');
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  const warning = 'Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.';
  const warningRow = screen.getByText(warning).closest('tr');
  expect(warningRow).toHaveTextContent('WO-100');
  expect(screen.getAllByText(warning)).toHaveLength(1);
});

it('previews the persisted batch and disables the upload action while unsaved edits remain', async () => {
  await setup();
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockResolvedValue({ draft_id: 'group', version: 2, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 1 WO. Maximo chưa thay đổi.');
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'group', version: 2, preview_hash: 'c'.repeat(64),
    send_enabled: false, gate: 'write_contract_unverified', items: [{ site_id: 'BD1', workorder_id: '100', code: 'ready', warnings: [],
      before: { estdur: '8' }, changes: { estdur: '9' } }] });
  fireEvent.click(screen.getByText('Đối chiếu nhóm với Maximo trước upload'));
  expect(await screen.findByText('Maximo chưa thay đổi. Upload chưa mở vì chưa hoàn tất kiểm chứng cập nhật Maximo.')).toBeInTheDocument();
  expect(previewUpload).toHaveBeenCalledWith(expect.objectContaining({ draft_id: 'group', version: 2 }),
    [{ site_id: 'BD1', workorder_id: '100' }], expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '10' } });
  expect(screen.getByText('Ẩn đối chiếu')).toBeInTheDocument();
});

it('blocks upload preview for a restored batch containing a schedule outside its target window', async () => {
  const row = { ...details[0], baseline: { ...details[0].baseline,
    schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-05T16:00:00+07:00',
    targstartdate: '2026-10-05T08:00:00+07:00', targcompdate: '2026-10-05T16:00:00+07:00' },
    changes: { schedstart: '2026-10-05T08:00:00+07:00', schedfinish: '2026-10-05T17:00:00+07:00' } };
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'legacy-group', version: 1, state: 'draft', items: [row] });
  render(<BatchPlanner {...props} selection={{ draftId: 'legacy-group' }} />);
  await screen.findByLabelText('WO-100 Est. Duration');
  expect(screen.getByRole('alert')).toHaveTextContent(/Scheduled Finish .* vượt Target Finish/);
  expect(screen.getByText('Đối chiếu nhóm với Maximo trước upload')).toBeDisabled();
  expect(previewUpload).not.toHaveBeenCalled();
});

it.each([new Error('Network lost'), new RetrievalError(504, 'Yêu cầu xử lý quá thời gian.')])('preserves edits and request identity after an uncertain outcome (%s)', async (failure) => {
  await setup();
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockRejectedValueOnce(failure).mockResolvedValue({ draft_id: 'group', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText(failure.message);
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('9');
  expect(saveBatch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 1 WO. Maximo chưa thay đổi.');
  expect(vi.mocked(saveBatch).mock.calls[0][2]).toBe(vi.mocked(saveBatch).mock.calls[1][2]);
});

it('pastes empty trailing columns without clearing PIC and rejects invalid paste atomically', async () => {
  await setup();
  const input = screen.getByLabelText('Vùng dữ liệu Excel');
  fireEvent.change(input, { target: { value: '2026-10-05T08:00\t\t\n2026-10-06T08:00\t\t\n' } });
  fireEvent.click(screen.getByText('Kiểm tra và áp dữ liệu dán'));
  expect(screen.getByLabelText('WO-100 Assigned PIC')).toHaveValue('TECH');
  expect(getDateTime(screen.getByLabelText('WO-100 Scheduled Start'))).toBe('2026-10-05T08:00');
  expect(screen.getByLabelText('WO-100 Scheduled Finish')).toHaveValue('05/10/2026, 16:00');
  fireEvent.change(input, { target: { value: '\tOTHER\t9\n\tBAD\t10' } });
  fireEvent.click(screen.getByText('Kiểm tra và áp dữ liệu dán'));
  expect(screen.getByRole('alert')).toHaveTextContent('WO-101');
  expect(screen.getByLabelText('WO-100 Assigned PIC')).toHaveValue('TECH');
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('8');
});

it('derives each group finish from its duration and recalculates row exceptions with undo', async () => {
  vi.mocked(prepareBatch).mockResolvedValue(details.map((row, index) => ({ ...row,
    baseline: { ...row.baseline, estdur: index ? '10.5' : '8' } })));
  render(<BatchPlanner {...props} />);
  await screen.findByLabelText('WO-100 Scheduled Start');
  expect(screen.queryByRole('checkbox', { name: 'Scheduled Finish' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('WO-100 Scheduled Finish')).toHaveAttribute('readonly');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Scheduled Start' }));
  setDateTime(screen.getByLabelText('Nhóm Scheduled Start'), '2026-10-05T08:00');
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  expect(screen.getByLabelText('WO-100 Scheduled Finish')).toHaveValue('05/10/2026, 16:00');
  expect(screen.getByLabelText('WO-101 Scheduled Finish')).toHaveValue('05/10/2026, 18:30');
  fireEvent.change(screen.getByLabelText('WO-101 Est. Duration'), { target: { value: '20' } });
  expect(screen.getByLabelText('WO-101 Scheduled Finish')).toHaveValue('06/10/2026, 16:00');
  fireEvent.click(screen.getByText('Undo'));
  expect(screen.getByLabelText('WO-101 Scheduled Finish')).toHaveValue('05/10/2026, 18:30');
});

it('keeps local edits but blocks saving a changed baseline after a session recheck', async () => {
  vi.mocked(prepareBatch).mockResolvedValue(details);
  const view = render(<BatchPlanner {...props} />);
  fireEvent.change(await screen.findByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  view.rerender(<BatchPlanner {...props} suspended />);
  vi.mocked(prepareBatch).mockResolvedValue(details.map((row) => ({ ...row, baseline_token: 'b'.repeat(64) })));
  await act(async () => view.rerender(<BatchPlanner {...props} />));
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('9');
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
});

it('reports a failed row and preserves the other proposed changes', async () => {
  await setup();
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockRejectedValue(new BatchError(409, [{ site_id: 'BD1', workorder_id: '100', code: 'baseline_changed' }]));
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('WO đã thay đổi; mở lại để đối chiếu.');
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('9');
  expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
});

it('refreshes a stale saved group in one click, keeps the typed changes and saves them with rebase', async () => {
  vi.mocked(openBatch).mockResolvedValueOnce({ draft_id: 'group', version: 1, state: 'draft',
    items: details.map((row) => ({ ...row, changes: { estdur: '9' } })) });
  render(<BatchPlanner {...props} selection={{ draftId: 'group' }} />);
  fireEvent.change(await screen.findByLabelText('WO-100 Est. Duration'), { target: { value: '10' } });
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockRejectedValueOnce(new BatchError(409, [{ site_id: 'BD1', workorder_id: '100', code: 'baseline_changed' }]));
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  const refresh = await screen.findByRole('button', { name: 'Cập nhật theo bản mới nhất' });
  vi.mocked(openBatch).mockResolvedValueOnce({ draft_id: 'group', version: 2, state: 'draft',
    items: details.map((row) => ({ ...row, baseline_token: 'c'.repeat(64), baseline_changed: true, changes: { estdur: '9' } })) });
  vi.mocked(saveBatch).mockResolvedValueOnce({ draft_id: 'group', version: 3, state: 'draft' });
  fireEvent.click(refresh);
  await screen.findByText(/Đã cập nhật theo bản mới nhất/);
  expect(screen.queryByRole('button', { name: 'Cập nhật theo bản mới nhất' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('10');
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await waitFor(() => expect(saveBatch).toHaveBeenCalledTimes(2));
  const call = vi.mocked(saveBatch).mock.calls[1];
  expect(call[3]).toMatchObject({ draft_id: 'group', version: 2 });
  expect(call[5]).toBe(true);
});

it('serializes business time and rejects invalid and ambiguous calendar times', () => {
  expect(zonedDateTime('2026-10-05T08:00', 'Asia/Ho_Chi_Minh')).toBe('2026-10-05T08:00:00+07:00');
  expect(() => zonedDateTime('2026-02-30T08:00', 'Asia/Ho_Chi_Minh')).toThrow();
  expect(() => zonedDateTime('2026-03-08T02:30', 'America/New_York')).toThrow();
  expect(() => zonedDateTime('2026-11-01T01:30', 'America/New_York')).toThrow();
});

it('clears inaccessible rows through the parent when scope verification fails', async () => {
  vi.mocked(prepareBatch).mockRejectedValue(new BatchError(409, [{ site_id: 'BD1', workorder_id: '101', code: 'unavailable' }]));
  render(<BatchPlanner {...props} />);
  await act(async () => {});
  expect(props.onDenied).toHaveBeenCalled();
  expect(screen.queryByLabelText('WO-100 Est. Duration')).not.toBeInTheDocument();
});

it('restores a multi-WO draft and deletes its exact version only after confirmation', async () => {
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'group', version: 3, state: 'draft',
    items: details.map((row) => ({ ...row, changes: { estdur: '9' } })) });
  vi.mocked(deleteDraft).mockResolvedValue();
  render(<BatchPlanner {...props} selection={{ draftId: 'group' }} />);
  expect(await screen.findByLabelText('WO-100 Est. Duration')).toHaveValue('9');
  fireEvent.click(screen.getByText('Xóa nháp nhóm'));
  expect(deleteDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Xác nhận xóa nháp nhóm'));
  await act(async () => {});
  expect(vi.mocked(deleteDraft).mock.calls[0][0]).toMatchObject({ draft_id: 'group', version: 3 });
  expect(props.onClose).toHaveBeenCalled();
});

it('warns once about starts outside the shift and can keep them or move them all to the nearest opening', async () => {
  vi.mocked(prepareBatch).mockResolvedValue(details.map((row) => ({ ...row, baseline: { ...row.baseline, estdur: '8' } })));
  render(<BatchPlanner {...props} />);
  await screen.findByLabelText('WO-100 Scheduled Start');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Scheduled Start' }));
  setDateTime(screen.getByLabelText('Nhóm Scheduled Start'), '2026-10-05T20:00');
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  expect(screen.getByText(/WO có giờ bắt đầu ngoài ca làm việc/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Dời tất cả sang đầu ca gần nhất'));
  expect(screen.queryByText(/WO có giờ bắt đầu ngoài ca làm việc/)).not.toBeInTheDocument();
  expect(getDateTime(screen.getByLabelText('WO-100 Scheduled Start'))).toBe('2026-10-06T06:30');
  expect(screen.getByLabelText('WO-100 Scheduled Finish')).toHaveValue('06/10/2026, 14:30');
});

// Send-only mode: the table assembled the group; the panel only summarizes it and uploads it.
const sendRows = details.map((detail, index) => ({ ...detail, changes: index === 0 ? { estdur: '9', assignedtechname: 'OTHER' } : { estdur: '10' },
  baseline_changed: false, changes_valid_now: true }));
async function setupSend(notes: string[] = []) {
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'group', version: 2, state: 'draft', items: sendRows });
  render(<BatchPlanner {...props} sendOnly sendNotes={notes} selection={{ draftId: 'group' }}
    connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} />);
  await screen.findByText('Đối chiếu nhóm với Maximo trước upload');
}

it('send-only mode shows a read-only summary and the upload section without any editing control', async () => {
  await setupSend(['Bỏ khỏi nhóm WO-102 vì thay đổi đã trùng Maximo hoặc PIC không còn hợp lệ.']);
  const panel = screen.getByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' });
  expect(within(panel).getByRole('heading', { name: 'Gửi 2 WO lên Maximo' })).toBeVisible();
  expect(within(panel).getByText('Onshore · TEST')).toBeVisible();
  expect(within(panel).getByText(/Bỏ khỏi nhóm WO-102/)).toBeVisible();
  const table = within(panel).getByRole('table', { name: 'Các WO sẽ gửi' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getByRole('rowheader', { name: /WO-100/ })).toBeVisible();
  expect(table).toHaveTextContent('OTHER');
  expect(screen.getByText('Đối chiếu nhóm với Maximo trước upload')).toBeEnabled();
  for (const absent of ['Áp dụng vào nháp', 'Undo', 'Xem trước thay đổi', 'Lưu nháp nhóm', 'Xóa nháp nhóm', 'Reset dòng']) {
    expect(screen.queryByText(absent)).not.toBeInTheDocument();
  }
  expect(screen.queryByLabelText('WO-100 Est. Duration')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Vùng dữ liệu Excel')).not.toBeInTheDocument();
  expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
  expect(saveBatch).not.toHaveBeenCalled();
  expect(prepareBatch).not.toHaveBeenCalled();
});

it('send-only mode previews the persisted group against Maximo before upload', async () => {
  await setupSend();
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'group', version: 2, preview_hash: 'c'.repeat(64),
    send_enabled: false, gate: 'write_contract_unverified', items: sendRows.map((row) => ({ site_id: row.item.siteid, workorder_id: row.item.workorderid,
      code: 'ready' as const, warnings: [], before: { estdur: '8' }, changes: { estdur: row.changes.estdur! } })) });
  fireEvent.click(screen.getByText('Đối chiếu nhóm với Maximo trước upload'));
  expect(await screen.findByText('Maximo chưa thay đổi. Upload chưa mở vì chưa hoàn tất kiểm chứng cập nhật Maximo.')).toBeInTheDocument();
  expect(previewUpload).toHaveBeenCalledWith(expect.objectContaining({ draft_id: 'group', version: 2 }),
    sendRows.map((row) => ({ site_id: row.item.siteid, workorder_id: row.item.workorderid })), expect.any(AbortSignal));
});
