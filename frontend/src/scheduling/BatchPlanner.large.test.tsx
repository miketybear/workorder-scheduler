import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BatchPlanner } from './BatchPlanner';
import { BatchError, openBatch, prepareBatch, saveBatch, type Detail } from '../api/drafts';
import { columns, RetrievalError, type WorkOrder } from '../api/workOrders';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), prepareBatch: vi.fn(), saveBatch: vi.fn(), openBatch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const scope = { connection_id: 'one', discipline: 'MECH' };
function monthlyRows(count: number): Detail[] {
  return Array.from({ length: count }, (_, index) => ({
    item: { ...Object.fromEntries(columns.map(([key]) => [key, null])),
      siteid: index % 2 ? 'SITE-B' : 'SITE-A', workorderid: String(1000 + index), wonum: `MONTH-${index + 1}`,
      status: 'APPR', worktype: index % 10 === 0 ? 'PM' : 'CM', bdpocdiscipline: 'MECH', wopriority: 0,
    } as WorkOrder,
    baseline_token: 'a'.repeat(64), allowed_pics: ['TECH', 'OTHER'], baseline: {
      worktype: index % 10 === 0 ? 'PM' : 'CM', schedstart: null, schedfinish: null,
      assignedtechname: 'TECH', estdur: '8', targstartdate: null, targcompdate: null,
    },
  }));
}
function props(rows: Detail[]) {
  return { scope, selection: { keys: rows.map(({ item }) => ({ site_id: item.siteid, workorder_id: item.workorderid })) },
    timezone: 'Asia/Ho_Chi_Minh', writable: true, suspended: false,
    onDirty: vi.fn(), onDenied: vi.fn(), onClose: vi.fn() };
}

it.each([100, 200])('edits, pastes, previews, saves and restores a %i-WO monthly batch with row exceptions', async (count) => {
  const rows = monthlyRows(count), callbacks = props(rows);
  vi.mocked(prepareBatch).mockResolvedValue(rows);
  const view = render(<BatchPlanner {...callbacks} />);
  await screen.findByLabelText(`MONTH-${count} Est. Duration`);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Scheduled Start' }));
  fireEvent.change(screen.getByLabelText('Nhóm Scheduled Start'), { target: { value: '2026-10-08T08:00' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Assigned PIC' }));
  fireEvent.change(screen.getByLabelText('Nhóm Assigned PIC'), { target: { value: 'OTHER' } });
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  expect(screen.getByLabelText(`MONTH-${count} Scheduled Finish`)).toHaveValue('08/10/2026, 16:00');
  fireEvent.change(screen.getByLabelText(`MONTH-${count} Est. Duration`), { target: { value: '2.25' } });
  expect(screen.getByLabelText(`MONTH-${count} Scheduled Finish`)).toHaveValue('08/10/2026, 10:15');
  fireEvent.click(screen.getByText('Undo'));
  expect(screen.getByLabelText(`MONTH-${count} Est. Duration`)).toHaveValue('8');
  const lastRow = screen.getByLabelText(`MONTH-${count} Est. Duration`).closest('tr')!;
  fireEvent.click(within(lastRow).getByText('Reset dòng'));
  expect(screen.getByLabelText(`MONTH-${count} Scheduled Start`)).toHaveValue('');
  fireEvent.click(screen.getByText('Undo'));

  const paste = screen.getByLabelText('Vùng dữ liệu Excel');
  const invalid = rows.map((_, index) => `2026-10-09T08:00\t${index === count - 1 ? 'BAD' : 'TECH'}\t9`).join('\r\n');
  fireEvent.change(paste, { target: { value: invalid } });
  fireEvent.click(screen.getByText('Kiểm tra và áp dữ liệu dán'));
  expect(screen.getByRole('alert')).toHaveTextContent(`MONTH-${count}`);
  expect(screen.getByLabelText('MONTH-1 Assigned PIC')).toHaveValue('OTHER');
  expect(screen.getByLabelText('MONTH-1 Scheduled Start')).toHaveValue('2026-10-08T08:00');
  const valid = rows.map((_, index) => `2026-10-09T08:00\t\t${index === count - 1 ? '2.25' : '9.5'}`).join('\r\n') + '\r\n';
  fireEvent.change(paste, { target: { value: valid } });
  fireEvent.click(screen.getByText('Kiểm tra và áp dữ liệu dán'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('MONTH-1 Assigned PIC')).toHaveValue('OTHER');
  expect(screen.getByLabelText('MONTH-1 Scheduled Finish')).toHaveValue('09/10/2026, 17:30');
  expect(screen.getByLabelText(`MONTH-${count} Scheduled Finish`)).toHaveValue('09/10/2026, 10:15');
  expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  expect(within(screen.getByRole('region', { name: 'Preview nhóm' })).getAllByRole('row')).toHaveLength(count * 4 + 1);
  vi.mocked(saveBatch).mockResolvedValue({ draft_id: 'monthly', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText(`Đã lưu nháp ${count} WO · v1. Maximo chưa thay đổi.`);
  const saved = vi.mocked(saveBatch).mock.calls[0][1];
  expect(saved).toHaveLength(count);
  expect(saved.map(({ item }) => [item.siteid, item.workorderid])).toEqual(rows.map(({ item }) => [item.siteid, item.workorderid]));
  expect(saved[0].changes).toEqual({ schedstart: '2026-10-09T08:00:00+07:00', schedfinish: '2026-10-09T10:30:00.000Z', assignedtechname: 'OTHER', estdur: '9.5' });
  expect(saved.at(-1)?.changes.estdur).toBe('2.25');
  await vi.waitFor(() => expect(callbacks.onDirty).toHaveBeenLastCalledWith(false));
  view.unmount();
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'monthly', version: 1, state: 'draft', items: saved });
  render(<BatchPlanner {...callbacks} selection={{ draftId: 'monthly' }} />);
  expect(await screen.findByLabelText(`MONTH-${count} Est. Duration`)).toHaveValue('2.25');
  expect(screen.getByLabelText('MONTH-1 Assigned PIC')).toHaveValue('OTHER');
  expect(prepareBatch).toHaveBeenCalledTimes(1);
}, 15000);

it.each(['baseline', 'version', 'revoked', 'late'])('keeps a 200-WO batch isolated after %s responses', async (fault) => {
  const rows = monthlyRows(200), callbacks = props(rows);
  vi.mocked(prepareBatch).mockResolvedValue(rows);
  const view = render(<BatchPlanner {...callbacks} />);
  fireEvent.change(await screen.findByLabelText('MONTH-200 Est. Duration'), { target: { value: '9' } });
  if (fault === 'late') {
    let finish!: (result: Detail[]) => void;
    vi.mocked(prepareBatch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    view.rerender(<BatchPlanner {...callbacks} refreshVersion={1} />);
    await vi.waitFor(() => expect(prepareBatch).toHaveBeenCalledTimes(2));
    const signal = vi.mocked(prepareBatch).mock.calls[1][2];
    view.unmount(); finish(rows);
    expect(signal.aborted).toBe(true);
    expect(callbacks.onDenied).not.toHaveBeenCalled();
    expect(saveBatch).not.toHaveBeenCalled();
    return;
  }
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  if (fault === 'revoked') vi.mocked(saveBatch).mockRejectedValue(new RetrievalError(403, 'Access revoked'));
  else if (fault === 'version') vi.mocked(saveBatch).mockRejectedValue(new RetrievalError(409, 'Draft version changed'));
  else vi.mocked(saveBatch).mockRejectedValue(new BatchError(409, [{ site_id: rows[199].item.siteid, workorder_id: rows[199].item.workorderid, code: 'baseline_changed' }]));
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  if (fault === 'revoked') {
    await vi.waitFor(() => expect(callbacks.onDenied).toHaveBeenCalledTimes(1));
  } else {
    await screen.findAllByRole('alert');
    expect(screen.getByLabelText('MONTH-200 Est. Duration')).toHaveValue('9');
    expect(screen.getByLabelText('MONTH-1 Est. Duration')).toHaveValue('8');
    expect(callbacks.onDirty).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Lưu nháp nhóm')).toBeDisabled();
  }
}, 15000);
