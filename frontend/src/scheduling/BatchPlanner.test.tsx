import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BatchPlanner } from './BatchPlanner';
import { BatchError, deleteDraft, openBatch, prepareBatch, saveBatch, type Detail } from '../api/drafts';
import { columns, type WorkOrder } from '../api/workOrders';
import { zonedDateTime } from '../api/dates';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), prepareBatch: vi.fn(), saveBatch: vi.fn(), openBatch: vi.fn(), deleteDraft: vi.fn() }));
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
  expect(info.closest('td')).toHaveAttribute('colspan', '6');
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
  await screen.findByText('Đã lưu nháp 2 WO · v1. Maximo chưa thay đổi.');
  expect(vi.mocked(saveBatch).mock.calls[0][1]).toHaveLength(2);
  expect(props.onDirty).toHaveBeenLastCalledWith(false);
});

it('preserves edits and request identity after an uncertain network outcome', async () => {
  await setup();
  fireEvent.change(screen.getByLabelText('WO-100 Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  vi.mocked(saveBatch).mockRejectedValueOnce(new Error('Network lost')).mockResolvedValue({ draft_id: 'group', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Network lost');
  expect(screen.getByLabelText('WO-100 Est. Duration')).toHaveValue('9');
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 1 WO · v1. Maximo chưa thay đổi.');
  expect(vi.mocked(saveBatch).mock.calls[0][2]).toBe(vi.mocked(saveBatch).mock.calls[1][2]);
});

it('pastes empty trailing columns without clearing PIC and rejects invalid paste atomically', async () => {
  await setup();
  const input = screen.getByLabelText('Vùng dữ liệu Excel');
  fireEvent.change(input, { target: { value: '2026-10-05T08:00\t\t\n2026-10-06T08:00\t\t\n' } });
  fireEvent.click(screen.getByText('Kiểm tra và áp dữ liệu dán'));
  expect(screen.getByLabelText('WO-100 Assigned PIC')).toHaveValue('TECH');
  expect(screen.getByLabelText('WO-100 Scheduled Start')).toHaveValue('2026-10-05T08:00');
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
  fireEvent.change(screen.getByLabelText('Nhóm Scheduled Start'), { target: { value: '2026-10-05T08:00' } });
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  expect(screen.getByLabelText('WO-100 Scheduled Finish')).toHaveValue('05/10/2026, 16:00');
  expect(screen.getByLabelText('WO-101 Scheduled Finish')).toHaveValue('05/10/2026, 18:30');
  fireEvent.change(screen.getByLabelText('WO-101 Est. Duration'), { target: { value: '20' } });
  expect(screen.getByLabelText('WO-101 Scheduled Finish')).toHaveValue('06/10/2026, 04:00');
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
