import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteDraft, getDetail, openDraft, saveDraft, type Detail, type Restored } from '../api/drafts';
import { columns, RetrievalError, type WorkOrder } from '../api/workOrders';
import { DraftEditor } from './DraftEditor';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(),
  getDetail: vi.fn(), openDraft: vi.fn(), saveDraft: vi.fn(), deleteDraft: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });
const scope = { connection_id: 'one', discipline: 'MECH' };
const selection = { key: { ...scope, site_id: 'TEST', workorder_id: '100' } };
const baseline = { worktype: 'CM', schedstart: '2026-09-30T08:00:00+07:00', schedfinish: '2026-09-30T16:00:00+07:00',
  assignedtechname: 'TECH', estdur: '8', targstartdate: '2026-09-30T08:00:00+07:00', targcompdate: '2026-09-30T16:00:00+07:00' };
const detail: Detail = { baseline, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH', 'OTHER'], item: {
  ...Object.fromEntries(columns.map(([field]) => [field, null])), ...baseline, siteid: 'TEST', workorderid: '100',
  wonum: 'WO-100', status: 'APPR', bdpocdiscipline: 'MECH', wopriority: 0,
} as WorkOrder };
const props = { selection, scope, timezone: 'Asia/Ho_Chi_Minh', writable: true, suspended: false, onDirty: vi.fn(), onDenied: vi.fn(), onClose: vi.fn() };

it('preserves edits after a failed save and retries with the same request ID; supports updating the saved version', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  vi.mocked(saveDraft).mockRejectedValueOnce(new Error('Network lost')).mockResolvedValue({ draft_id: 'id', version: 1, state: 'draft' });
  render(<DraftEditor {...props} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  expect(screen.getByRole('table')).toHaveTextContent('89');
  fireEvent.click(screen.getByText('Lưu nháp'));
  await screen.findByText('Network lost');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  fireEvent.click(screen.getByText('Lưu nháp'));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  expect(vi.mocked(saveDraft).mock.calls[0][3]).toBe(vi.mocked(saveDraft).mock.calls[1][3]);
  expect(props.onDirty).toHaveBeenLastCalledWith(false);
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Est. Duration'), { target: { value: '10' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(3));
  expect(vi.mocked(saveDraft).mock.calls[2][4]).toMatchObject({ version: 1 });
  expect(vi.mocked(saveDraft).mock.calls[2][3]).not.toBe(vi.mocked(saveDraft).mock.calls[0][3]);
});

it('requires target intent, resets targets when unchecked, and validates duration and dates before saving', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  render(<DraftEditor {...props} />);
  expect(await screen.findByLabelText('Target Finish')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Target Finish'), { target: { value: '2026-10-01T16:00' } });
  expect(screen.getByLabelText('Change Target?')).toBeChecked();
  fireEvent.click(screen.getByLabelText('Change Target?'));
  expect(screen.getByLabelText('Target Finish')).toHaveValue('2026-09-30T16:00');
  fireEvent.change(screen.getByLabelText('Est. Duration'), { target: { value: '-1' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Duration phải là số không âm');
  fireEvent.click(screen.getByText('Reset về baseline'));
  fireEvent.change(screen.getByLabelText('Target Finish'), { target: { value: '2026-09-29T16:00' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  expect(await screen.findByRole('alert')).toHaveTextContent('kết thúc không được trước bắt đầu');
  expect(saveDraft).not.toHaveBeenCalled();
});

it.each(['PM', 'CFT'])('locks target controls for %s', async (worktype) => {
  vi.mocked(getDetail).mockResolvedValue({ ...detail, baseline: { ...baseline, worktype } });
  render(<DraftEditor {...props} />);
  expect(await screen.findByLabelText('Change Target?')).toBeDisabled();
  expect(screen.getByLabelText('Target Start')).toBeDisabled();
});

it.each(['read-only', 'session recheck', 'missing crew'])('disables editing and footer actions during %s', async (condition) => {
  vi.mocked(getDetail).mockResolvedValue({ ...detail, pics_configured: condition !== 'missing crew' });
  const view = render(<DraftEditor {...props} />);
  await screen.findByLabelText('Est. Duration');
  view.rerender(<DraftEditor {...props} writable={condition !== 'read-only'} suspended={condition === 'session recheck'} />);
  expect(screen.getByLabelText('Est. Duration')).toBeDisabled();
  expect(screen.getByText('Reset về baseline')).toBeDisabled();
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(saveDraft).not.toHaveBeenCalled();
});

it('opens a saved draft and blocks stale baseline saves while retaining its proposed changes', async () => {
  const restored: Restored = { ...detail, draft_id: 'id', version: 2, state: 'draft', changes: { estdur: '12' },
    baseline_changed: true, changes_valid_now: true };
  vi.mocked(openDraft).mockResolvedValue(restored);
  render(<DraftEditor {...props} selection={{ draftId: 'id' }} />);
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('12');
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Dữ liệu gốc hoặc PIC đã thay đổi');
  expect(props.onDirty).toHaveBeenLastCalledWith(false);
  const confirm = vi.spyOn(window, 'confirm');
  vi.mocked(deleteDraft).mockResolvedValue();
  fireEvent.click(screen.getByText('Xóa nháp'));
  expect(deleteDraft).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Hủy xóa'));
  expect(screen.queryByRole('group', { name: 'Xác nhận xóa nháp' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Xóa nháp'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  expect(vi.mocked(deleteDraft).mock.calls[0][0]).toMatchObject({ draft_id: 'id', version: 2 });
});

it('keeps edits across session rechecks and ignores save responses after cancellation', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  let finish!: (result: { draft_id: string; version: number; state: 'draft' }) => void;
  vi.mocked(saveDraft).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const view = render(<DraftEditor {...props} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  view.rerender(<DraftEditor {...props} suspended />);
  expect(vi.mocked(saveDraft).mock.calls[0][5].aborted).toBe(true);
  await act(async () => finish({ draft_id: 'id', version: 1, state: 'draft' }));
  view.rerender(<DraftEditor {...props} />);
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.queryByText(/Đã lưu nháp trên/)).not.toBeInTheDocument();
});

it('clears access after a denied save', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  vi.mocked(saveDraft).mockRejectedValue(new RetrievalError(404, 'Denied'));
  render(<DraftEditor {...props} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  await waitFor(() => expect(props.onDenied).toHaveBeenCalled());
});

it('retains a saved draft on delete version conflict instead of closing it or invalidating access', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, draft_id: 'id', version: 2, state: 'draft',
    changes: { estdur: '12' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(deleteDraft).mockRejectedValue(new RetrievalError(409, 'Nháp đã thay đổi phiên bản'));
  render(<DraftEditor {...props} selection={{ draftId: 'id' }} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Xóa nháp'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nháp đã thay đổi phiên bản');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('12');
  expect(props.onDenied).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});

it('keeps unsaved edits but blocks saving when explicit verification finds a newer draft version', async () => {
  const restored: Restored = { ...detail, draft_id: 'id', version: 1, state: 'draft',
    changes: { estdur: '10' }, baseline_changed: false, changes_valid_now: true };
  vi.mocked(openDraft).mockResolvedValue(restored);
  const view = render(<DraftEditor {...props} selection={{ draftId: 'id' }} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '12' } });
  view.rerender(<DraftEditor {...props} selection={{ draftId: 'id' }} verifiedDetail={{ ...restored, version: 2 }} />);
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('12');
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Nháp đã thay đổi phiên bản');
  expect(saveDraft).not.toHaveBeenCalled();
});

it('treats equivalent durations and timezone instants as unchanged', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  render(<DraftEditor {...props} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '08.00' } });
  fireEvent.change(screen.getByLabelText('Scheduled Start'), { target: { value: '2026-09-30T08:00' } });
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(props.onDirty).toHaveBeenLastCalledWith(false);
});

it('blocks clearing a date through the date picker', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  render(<DraftEditor {...props} />);
  fireEvent.change(await screen.findByLabelText('Scheduled Start'), { target: { value: '' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  expect(screen.getByRole('alert')).toHaveTextContent('Chưa hỗ trợ xóa giá trị.');
  expect(saveDraft).not.toHaveBeenCalled();
});

it('uses date pickers in the connection timezone and serializes a changed date with its offset', async () => {
  vi.mocked(getDetail).mockResolvedValue({ ...detail, baseline: { ...baseline, schedfinish: '2026-09-30T09:00:00Z' } });
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'id', version: 1, state: 'draft' });
  render(<DraftEditor {...props} />);
  const finish = await screen.findByLabelText('Scheduled Finish');
  for (const label of ['Scheduled Start', 'Target Start', 'Target Finish']) {
    expect(screen.getByLabelText(label)).toHaveAttribute('type', 'datetime-local');
  }
  expect(finish).toHaveAttribute('readonly');
  expect(finish).toHaveValue('30/09/2026, 16:00');
  fireEvent.change(screen.getByLabelText('Scheduled Start'), { target: { value: '2026-10-01T13:45' } });
  expect(finish).toHaveValue('01/10/2026, 21:45');
  expect(screen.getByRole('table')).toHaveTextContent('01/10/2026, 13:45');
  fireEvent.click(screen.getByText('Lưu nháp'));
  await waitFor(() => expect(saveDraft).toHaveBeenCalled());
  expect(vi.mocked(saveDraft).mock.calls[0][1]).toEqual({ schedstart: '2026-10-01T13:45:00+07:00', schedfinish: '2026-10-01T14:45:00.000Z' });
});

it('enables both target pickers and sends explicit intent after selecting a target date', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'id', version: 1, state: 'draft' });
  render(<DraftEditor {...props} />);
  expect(await screen.findByLabelText('Target Start')).toBeEnabled();
  expect(screen.getByLabelText('Target Finish')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Target Finish'), { target: { value: '2026-10-01T16:00' } });
  expect(screen.getByLabelText('Change Target?')).toBeChecked();
  expect(screen.queryByText(/Lập lịch ·/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Lưu nháp'));
  await waitFor(() => expect(saveDraft).toHaveBeenCalled());
  expect(vi.mocked(saveDraft).mock.calls[0][1]).toEqual({ change_target: true, targcompdate: '2026-10-01T16:00:00+07:00' });
});
