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
const props = { selection, scope, writable: true, suspended: false, onDirty: vi.fn(), onDenied: vi.fn(), onClose: vi.fn() };

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
  fireEvent.change(screen.getByLabelText('Est. Duration'), { target: { value: '10' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(3));
  expect(vi.mocked(saveDraft).mock.calls[2][4]).toMatchObject({ version: 1 });
  expect(vi.mocked(saveDraft).mock.calls[2][3]).not.toBe(vi.mocked(saveDraft).mock.calls[0][3]);
});

it('requires target intent, resets targets when unchecked, and validates duration and dates before saving', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  render(<DraftEditor {...props} />);
  expect(await screen.findByLabelText('Target Finish')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Change Target?'));
  fireEvent.change(screen.getByLabelText('Target Finish'), { target: { value: '2026-10-01T16:00:00+07:00' } });
  fireEvent.click(screen.getByLabelText('Change Target?'));
  expect(screen.getByLabelText('Target Finish')).toHaveValue(baseline.targcompdate);
  fireEvent.change(screen.getByLabelText('Est. Duration'), { target: { value: '-1' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Duration phải là số không âm');
  fireEvent.click(screen.getByText('Reset về baseline'));
  fireEvent.change(screen.getByLabelText('Scheduled Finish'), { target: { value: '2026-09-29T16:00:00+07:00' } });
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

it('opens a saved draft and blocks stale baseline saves while retaining its proposed changes', async () => {
  const restored: Restored = { ...detail, draft_id: 'id', version: 2, state: 'draft', changes: { estdur: '12' },
    baseline_changed: true, changes_valid_now: true };
  vi.mocked(openDraft).mockResolvedValue(restored);
  render(<DraftEditor {...props} selection={{ draftId: 'id' }} />);
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('12');
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Dữ liệu gốc hoặc PIC đã thay đổi');
  expect(props.onDirty).toHaveBeenLastCalledWith(false);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(deleteDraft).mockResolvedValue();
  fireEvent.click(screen.getByText('Xóa nháp'));
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
