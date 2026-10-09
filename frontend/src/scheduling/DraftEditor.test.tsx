import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteDraft, getDetail, openDraft, previewUpload, saveDraft, submitUpload, type Detail, type Restored, type UploadPreview } from '../api/drafts';
import { columns, RetrievalError, type WorkOrder } from '../api/workOrders';
import { DraftEditor } from './DraftEditor';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(),
  getDetail: vi.fn(), openDraft: vi.fn(), saveDraft: vi.fn(), deleteDraft: vi.fn(), previewUpload: vi.fn(), submitUpload: vi.fn() }));
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

it('previews only the saved single-WO version and hides that response as soon as edits become unsaved', async () => {
  vi.mocked(getDetail).mockResolvedValue(detail);
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'saved', version: 4, state: 'draft' });
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'saved', version: 4, preview_hash: 'b'.repeat(64),
    send_enabled: false, gate: 'write_contract_unverified', items: [{ site_id: 'TEST', workorder_id: '100', code: 'ready', warnings: [],
      before: { estdur: '8' }, changes: { estdur: '9' } }] });
  render(<DraftEditor {...props} connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  expect(await screen.findByText('Maximo hiện tại')).toBeInTheDocument();
  expect(screen.getByText(/Upload chưa mở/)).toBeInTheDocument();
  expect(screen.getByText('Maximo chưa thay đổi. Upload chưa mở vì chưa hoàn tất kiểm chứng cập nhật Maximo.')).toBeInTheDocument();
  expect(previewUpload).toHaveBeenCalledWith(expect.objectContaining({ draft_id: 'saved', version: 4 }),
    [{ site_id: 'TEST', workorder_id: '100' }], expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText('Est. Duration'), { target: { value: '10' } });
  expect(screen.getByText('Ẩn đối chiếu')).toBeInTheDocument();
  expect(screen.queryByText('Maximo chưa thay đổi. Upload chưa mở vì chưa hoàn tất kiểm chứng cập nhật Maximo.')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Est. Duration'), { target: { value: '11' } });
  expect(screen.queryByText('Upload chưa khả dụng')).not.toBeInTheDocument();
});

it('aborts and discards an in-flight preview when the workspace is hidden, without fetching again on return', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, draft_id: 'saved', version: 4, state: 'draft', changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });
  let resolvePreview!: (value: UploadPreview) => void;
  vi.mocked(previewUpload).mockReturnValue(new Promise((resolve) => { resolvePreview = resolve; }));
  const view = render(<DraftEditor {...props} selection={{ draftId: 'saved' }} active />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await screen.findByText('Đang đối chiếu với Maximo…');
  const signal = vi.mocked(previewUpload).mock.calls[0][2];
  view.rerender(<DraftEditor {...props} selection={{ draftId: 'saved' }} active={false} />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolvePreview({ draft_id: 'saved', version: 4, preview_hash: 'd'.repeat(64), send_enabled: false,
    gate: 'write_contract_unverified', items: [{ site_id: 'TEST', workorder_id: '100', code: 'ready', warnings: [], before: { estdur: '8' }, changes: { estdur: '9' } }] }));
  expect(screen.queryByText('Maximo chưa thay đổi. Upload chưa mở vì chưa hoàn tất kiểm chứng cập nhật Maximo.')).not.toBeInTheDocument();
  view.rerender(<DraftEditor {...props} selection={{ draftId: 'saved' }} active />);
  expect(screen.getByText('Đối chiếu với Maximo trước upload')).toBeInTheDocument();
  expect(previewUpload).toHaveBeenCalledTimes(1);
});

it('shows a conflict with no changed fields instead of dropping the WO from preview', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, draft_id: 'saved', version: 4, state: 'draft', changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'saved', version: 4, preview_hash: 'e'.repeat(64), send_enabled: false,
    gate: 'write_contract_unverified', items: [{ site_id: 'TEST', workorder_id: '100', code: 'conflict', warnings: [], before: {}, changes: {} }] });
  render(<DraftEditor {...props} selection={{ draftId: 'saved' }} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  expect(await screen.findByText('Không có trường nào đủ điều kiện đối chiếu.')).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /WO-100/ })).toHaveTextContent('Xung đột');
});

it('shows conflicts even when the connection can upload other ready rows and keeps submit disabled', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, draft_id: 'saved', version: 4, state: 'draft', changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'saved', version: 4, preview_hash: 'd'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'TEST', workorder_id: '100', code: 'conflict', warnings: [], before: {}, changes: {} }] });
  render(<DraftEditor {...props} selection={{ draftId: 'saved' }} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  expect(await screen.findByRole('row', { name: /WO-100/ })).toHaveTextContent('Xung đột');
  expect(screen.getByText('Upload chưa khả dụng')).toBeDisabled();
  expect(screen.queryByText('Upload lên Onshore test')).not.toBeInTheDocument();
  expect(submitUpload).not.toHaveBeenCalled();
});

it.each([401, 500])('keeps the restored editor intact after upload preview error %s', async (status) => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, draft_id: 'saved', version: 4, state: 'draft', changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(previewUpload).mockRejectedValue(new RetrievalError(status, 'Preview failed'));
  render(<DraftEditor {...props} selection={{ draftId: 'saved' }} />);
  const duration = await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await waitFor(() => status === 401 ? expect(props.onDenied).toHaveBeenCalled() : expect(screen.getByRole('alert')).toHaveTextContent('Preview failed'));
  expect(duration).toHaveValue('9');
  expect(props.onClose).not.toHaveBeenCalled();
  if (status === 500) expect(props.onDenied).not.toHaveBeenCalled();
});

it('retains the same request ID after an uncertain server error and recovers without a new preview', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, draft_id: 'saved', version: 4, state: 'draft', changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });
  const ready: UploadPreview = { draft_id: 'saved', version: 4, preview_hash: 'f'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'TEST', workorder_id: '100', code: 'ready', warnings: [], before: { estdur: '8' }, changes: { estdur: '9' } }] };
  vi.mocked(previewUpload).mockResolvedValue(ready);
  vi.mocked(submitUpload).mockRejectedValueOnce(new RetrievalError(503, 'temporary failure')).mockResolvedValueOnce({
    batch_id: 'batch', source_finalized: false, counts: { pending: 1 }, items: [{ item_id: 'item', connection_id: 'one',
      site_id: 'TEST', workorder_id: '100', state: 'pending', updated_at: '2026-10-08T00:00:00Z',
      source: { draft_id: 'saved', draft_version: 4, member_id: 'member' }, duration_result: null, restore_source: null }],
  });
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
  const view = render(<DraftEditor {...props} selection={{ draftId: 'saved' }} connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText('Upload lên Onshore test'));
  await screen.findByText('Lấy kết quả yêu cầu trước');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(submitUpload).toHaveBeenCalledTimes(1);
  const firstCall = vi.mocked(submitUpload).mock.calls[0];
  const requestId = firstCall[1];
  view.rerender(<DraftEditor {...props} selection={{ draftId: 'saved' }} active={false}
    connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} />);
  view.rerender(<DraftEditor {...props} selection={{ draftId: 'saved' }} active={true}
    connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} timezone="UTC" />);
  fireEvent.click(screen.getByText('Lấy kết quả yêu cầu trước'));
  await screen.findByText('Kết quả từng WO');
  expect(submitUpload).toHaveBeenCalledTimes(2);
  expect(vi.mocked(submitUpload).mock.calls[1][1]).toBe(requestId);
  expect(vi.mocked(submitUpload).mock.calls[1][2]).toBe(firstCall[2]);
  expect(vi.mocked(submitUpload).mock.calls[1][3]).toBe(firstCall[3]);
  expect(previewUpload).toHaveBeenCalledTimes(2);
});

it('warns on PM schedule preview and shows the confirmed Maximo duration after upload', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, item: { ...detail.item, worktype: 'PM' }, baseline: { ...detail.baseline, worktype: 'PM' },
    draft_id: 'saved', version: 4, state: 'draft', changes: { schedstart: '2026-10-01T09:00:00+07:00' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'saved', version: 4, preview_hash: 'a'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'TEST', workorder_id: '100', code: 'ready', warnings: ['pm_duration_recalculation'],
      before: { schedstart: '2026-10-01T08:00:00+07:00' }, changes: { schedstart: '2026-10-01T09:00:00+07:00' } }] });
  vi.mocked(submitUpload).mockResolvedValue({ batch_id: 'batch', source_finalized: true, counts: { confirmed: 1 }, items: [{
    item_id: 'upload', connection_id: 'one', site_id: 'TEST', workorder_id: '100', state: 'confirmed', updated_at: '2026-10-08T00:00:00Z',
    source: { draft_id: 'saved', draft_version: 4, member_id: 'member' }, duration_result: { code: 'pm_duration_recalculated', expected: '25', actual: '21' }, restore_source: null,
  }] });
  render(<DraftEditor {...props} selection={{ draftId: 'saved' }} connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  expect(await screen.findByText('Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Upload lên Onshore test'));
  expect(await screen.findByText('Maximo đã tính lại Duration: 25 → 21 giờ.')).toBeInTheDocument();
  expect(screen.getByText('Đã xác nhận')).toBeInTheDocument();
});

it('keeps an unknown PM duration mismatch unconfirmed and preserves the draft for explicit reconciliation', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, item: { ...detail.item, worktype: 'PM' }, baseline: { ...detail.baseline, worktype: 'PM' },
    draft_id: 'saved', version: 4, state: 'draft', changes: { schedstart: '2026-10-01T09:00:00+07:00' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'saved', version: 4, preview_hash: 'a'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'TEST', workorder_id: '100', code: 'ready', warnings: ['pm_duration_recalculation'],
      before: { schedstart: '2026-10-01T08:00:00+07:00' }, changes: { schedstart: '2026-10-01T09:00:00+07:00' } }] });
  vi.mocked(submitUpload).mockResolvedValue({ batch_id: 'batch', source_finalized: false, counts: { unknown: 1 }, items: [{
    item_id: 'upload', connection_id: 'one', site_id: 'TEST', workorder_id: '100', state: 'unknown', updated_at: '2026-10-08T00:00:00Z',
    source: { draft_id: 'saved', draft_version: 4, member_id: 'member' }, duration_result: { code: 'pm_duration_mismatch', expected: '25', actual: '21' }, restore_source: null,
  }] });
  render(<DraftEditor {...props} selection={{ draftId: 'saved' }} connection={{ label: 'Onshore test', system: 'onshore', environment: 'test' }} />);
  const duration = await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  expect(await screen.findByText('Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Upload lên Onshore test'));
  expect(await screen.findByText('Chưa xác nhận: Duration thực tế 21 giờ, dự kiến 25 giờ. Nháp được giữ lại; hãy đối chiếu trước khi xử lý tiếp.')).toBeInTheDocument();
  expect(duration).toHaveValue('8');
  expect(screen.getByText('Chưa xác định')).toBeInTheDocument();
  expect(submitUpload).toHaveBeenCalledTimes(1);
});

it('warns on a PM duration-only edit when its derived finish changes', async () => {
  vi.mocked(getDetail).mockResolvedValue({ ...detail, baseline: { ...detail.baseline, worktype: 'PM' }, item: { ...detail.item, worktype: 'PM' } });
  render(<DraftEditor {...props} />);
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  expect(await screen.findByText('Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.')).toBeInTheDocument();
});

it('warns for a restored PM finish-only change against the original baseline', async () => {
  vi.mocked(openDraft).mockResolvedValue({ ...detail, baseline: { ...detail.baseline, worktype: 'PM' }, item: { ...detail.item, worktype: 'PM' },
    draft_id: 'saved', version: 4, state: 'draft', changes: { schedfinish: '2026-10-01T17:00:00+07:00' }, baseline_changed: false, changes_valid_now: true });
  render(<DraftEditor {...props} selection={{ draftId: 'saved' }} />);
  expect(await screen.findByLabelText('Est. Duration')).toBeInTheDocument();
  expect(await screen.findByText('Maximo có thể tính lại Duration khi đổi ngày lịch PM. Duration thực tế sẽ được đọc lại sau upload.')).toBeInTheDocument();
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

it('prepares a date-only PM restoration and then a duration-only proposal without automatic writes', async () => {
  const original = { ...baseline, worktype: 'PM' };
  const shifted: Detail = { ...detail, baseline: { ...baseline, worktype: 'PM', schedstart: '2026-10-30T07:37:13+07:00',
    schedfinish: '2026-10-31T18:37:13+07:00', estdur: '21' }, item: { ...detail.item, worktype: 'PM',
    schedstart: '2026-10-30T07:37:13+07:00', schedfinish: '2026-10-31T18:37:13+07:00', estdur: '21' } };
  vi.mocked(getDetail).mockResolvedValue(shifted);
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'restore-draft', version: 1, state: 'draft' });
  const first = render(<DraftEditor {...props} pmRestoreOrigin={original} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục ngày lịch gốc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveDraft).mock.calls[0][1]).toEqual({ schedstart: original.schedstart, schedfinish: original.schedfinish });
  expect(submitUpload).not.toHaveBeenCalled();
  first.unmount();

  const atOriginalDates: Detail = { ...shifted, baseline: { ...shifted.baseline, schedstart: original.schedstart,
    schedfinish: original.schedfinish }, item: { ...shifted.item, schedstart: original.schedstart, schedfinish: original.schedfinish } };
  vi.mocked(getDetail).mockResolvedValue(atOriginalDates);
  const second = render(<DraftEditor {...props} selection={{ key: { ...scope, site_id: 'TEST', workorder_id: '100' } }} pmRestoreOrigin={original} />);
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục Duration gốc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraft).mock.calls[1][1]).toEqual({ estdur: original.estdur });
  expect(submitUpload).not.toHaveBeenCalled();
  second.unmount();
});

it('fails closed when PM original dates are null or current protected PIC/targets drift', async () => {
  const original = { ...baseline, worktype: 'PM', schedstart: null, schedfinish: null };
  const pmDetail: Detail = { ...detail, baseline: { ...baseline, worktype: 'PM' }, item: { ...detail.item, worktype: 'PM' } };
  vi.mocked(getDetail).mockResolvedValue(pmDetail);
  const view = render(<DraftEditor {...props} pmRestoreOrigin={original} />);
  await screen.findByLabelText('Est. Duration');
  expect(screen.getByRole('alert')).toHaveTextContent('Ngày lịch gốc bị thiếu hoặc không hợp lệ');
  expect(screen.getByRole('button', { name: 'Khôi phục ngày lịch gốc' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Khôi phục Duration gốc' })).toBeDisabled();
  view.unmount();

  const changedProtected: Detail = { ...pmDetail, baseline: { ...pmDetail.baseline, targcompdate: '2026-10-02T16:00:00+07:00' } };
  vi.mocked(getDetail).mockResolvedValue(changedProtected);
  render(<DraftEditor {...props} pmRestoreOrigin={{ ...baseline, worktype: 'PM' }} />);
  await screen.findByLabelText('Est. Duration');
  expect(screen.getByRole('alert')).toHaveTextContent('PIC, Target hoặc loại WO hiện tại khác dữ liệu gốc');
  expect(screen.getByRole('button', { name: 'Khôi phục ngày lịch gốc' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Khôi phục Duration gốc' })).toBeDisabled();
  expect(saveDraft).not.toHaveBeenCalled();
  expect(submitUpload).not.toHaveBeenCalled();
});

it('treats equivalent timezone offsets and numeric duration formatting as the original PM values', async () => {
  const original = { ...baseline, worktype: 'PM' };
  const semanticallySame: Detail = { ...detail, baseline: { ...original,
    schedstart: '2026-09-30T01:00:00Z', schedfinish: '2026-09-30T09:00:00Z', estdur: '8.0',
    targstartdate: '2026-09-30T01:00:00Z', targcompdate: '2026-09-30T09:00:00Z' },
  };
  vi.mocked(getDetail).mockResolvedValue(semanticallySame);
  render(<DraftEditor {...props} pmRestoreOrigin={original} />);
  await screen.findByLabelText('Est. Duration');
  expect(screen.getByRole('button', { name: 'Khôi phục ngày lịch gốc' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Khôi phục Duration gốc' })).toBeDisabled();
  expect(screen.queryByRole('alert', { name: /PIC, Target/ })).not.toBeInTheDocument();
});
