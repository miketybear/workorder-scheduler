import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { continueUpload, getUploadStatus, previewUpload, submitUpload, type Saved, type UploadPreview, type UploadStatus } from '../api/drafts';
import { UploadPreviewControls } from './UploadPreviewPanel';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), previewUpload: vi.fn(), submitUpload: vi.fn(), continueUpload: vi.fn(), getUploadStatus: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const draft: Saved = { draft_id: 'group', version: 2, state: 'draft' };
const preview: UploadPreview = { draft_id: 'group', version: 2, preview_hash: 'a'.repeat(64), send_enabled: true, gate: null,
  items: Array.from({ length: 200 }, (_, index) => ({ site_id: 'BD1', workorder_id: String(index + 1), code: 'ready',
    before: { estdur: '8' }, changes: { estdur: '9' }, warnings: [] })) };
const selection = preview.items.map((item, index) => ({ ...item, wonum: `WO-${index + 1}` }));
function receipt(confirmed: number, finalized = false): UploadStatus {
  return { batch_id: 'batch', source_finalized: finalized, counts: { confirmed, pending: 200 - confirmed }, items: selection.map((item, index) => ({
    item_id: String(index), connection_id: 'conn', site_id: item.site_id, workorder_id: item.workorder_id,
    state: index < confirmed ? 'confirmed' : 'pending', updated_at: '2026-10-10T00:00:00Z', source: null, restore_source: null, duration_result: null,
  })) };
}
const baseProps = { draft, selection, connectionId: 'conn', timezone: 'Asia/Ho_Chi_Minh', context: 'batch-v2',
  onDenied: vi.fn(), enabled: true, buttonLabel: 'Upload toàn bộ nhóm lên Onshore test', previewLabel: 'Đối chiếu nhóm', discipline: 'MECH', uploadAll: true };

it('shows an in-flight upload without claiming Maximo is unchanged or the result is unknown', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  let resolveSubmit!: (value: UploadStatus) => void;
  vi.mocked(submitUpload).mockReturnValueOnce(new Promise((resolve) => { resolveSubmit = resolve; }));
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Đang xử lý yêu cầu upload và kiểm tra kết quả…');
  expect(submitUpload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.')).not.toBeInTheDocument();
  expect(screen.queryByText('Kết quả yêu cầu chưa xác định; dữ liệu nháp được giữ nguyên.')).not.toBeInTheDocument();
  resolveSubmit(receipt(200, true));
  await screen.findByText('Tiến độ: 200/200 WO đã xác nhận.');
});

it('sends a 200 WO group in twenty sequential requests with one request ID and progress', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  vi.mocked(continueUpload).mockImplementation(async () => {
    const count = vi.mocked(continueUpload).mock.calls.length;
    return receipt(Math.min(200, 10 + count * 10), count === 19);
  });
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Tiến độ: 200/200 WO đã xác nhận.');
  expect(submitUpload).toHaveBeenCalledTimes(1);
  expect(continueUpload).toHaveBeenCalledTimes(19);
  expect(vi.mocked(submitUpload).mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
  expect(vi.mocked(continueUpload).mock.calls.every((call) => call[0] === 'batch')).toBe(true);
});

it('stops automatic chunks on an unknown result and resumes only after explicit reconciliation', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue({ ...receipt(9), counts: { confirmed: 9, pending: 190, unknown: 1 }, items: receipt(9).items.map((item, index) => index === 9 ? { ...item, state: 'unknown' } : item) });
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Kết quả chưa hoàn tất. Kiểm tra trạng thái để quyết định bước tiếp theo.');
  expect(continueUpload).not.toHaveBeenCalled();
});

it('requires a status lookup after a timed out chunk before resuming with the same batch', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  vi.mocked(continueUpload).mockRejectedValueOnce(new Error('Request timed out')).mockResolvedValue(receipt(200, true));
  vi.mocked(getUploadStatus).mockResolvedValue(receipt(10));
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByRole('alert');
  expect(continueUpload).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Tiến độ: 10/200 WO đã xác nhận.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Kiểm tra trạng thái'));
  await screen.findByText('Tiếp tục upload toàn bộ nhóm');
  fireEvent.click(screen.getByText('Tiếp tục upload toàn bộ nhóm'));
  await screen.findByText('Tiến độ: 200/200 WO đã xác nhận.');
  expect(getUploadStatus).toHaveBeenCalledTimes(1);
  expect(continueUpload).toHaveBeenCalledTimes(2);
});

it('does not write when stopped during the fresh preflight and ignores a duplicate click', async () => {
  vi.mocked(previewUpload).mockResolvedValueOnce(preview);
  let resolveFresh!: (value: UploadPreview) => void;
  vi.mocked(previewUpload).mockReturnValueOnce(new Promise((resolve) => { resolveFresh = resolve; }));
  const view = render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  const send = screen.getByText(baseProps.buttonLabel);
  fireEvent.click(send); fireEvent.click(send);
  expect(previewUpload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText('Dừng sau đợt đang gửi'));
  resolveFresh(preview);
  view.rerender(<UploadPreviewControls {...baseProps} />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(submitUpload).not.toHaveBeenCalled();
});

it('stops after the in-flight chunk when the group is hidden, even if it becomes visible again', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  let resolveChunk!: (value: UploadStatus) => void;
  vi.mocked(continueUpload).mockReturnValueOnce(new Promise((resolve) => { resolveChunk = resolve; }));
  const view = render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByRole('button', { name: 'Dừng sau đợt đang gửi' });
  view.rerender(<UploadPreviewControls {...baseProps} active={false} />);
  view.rerender(<UploadPreviewControls {...baseProps} active />);
  resolveChunk(receipt(20));
  await screen.findByText('Tiến độ: 20/200 WO đã xác nhận.');
  expect(continueUpload).toHaveBeenCalledTimes(1);
});

it('requires a status lookup after context changes during an in-flight chunk', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  vi.mocked(getUploadStatus).mockResolvedValue(receipt(20));
  let resolveChunk!: (value: UploadStatus) => void;
  vi.mocked(continueUpload).mockReturnValueOnce(new Promise((resolve) => { resolveChunk = resolve; }));
  const view = render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByRole('button', { name: 'Dừng sau đợt đang gửi' });
  view.rerender(<UploadPreviewControls {...baseProps} context="new-scope-context" />);
  resolveChunk(receipt(20));
  await screen.findByText('Tiến độ: 10/200 WO đã xác nhận.');
  expect(screen.queryByText('Tiếp tục upload toàn bộ nhóm')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Kiểm tra trạng thái'));
  await screen.findByText('Tiếp tục upload toàn bộ nhóm');
  expect(getUploadStatus).toHaveBeenCalledTimes(1);
  expect(continueUpload).toHaveBeenCalledTimes(1);
});

it.each(['failed', 'conflict', 'sending'] as const)('does not auto-continue when the first receipt contains %s work', async (state) => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  const partial = receipt(9);
  partial.counts = { confirmed: 9, pending: 200 - 10, [state]: 1 };
  partial.items[9] = { ...partial.items[9]!, state };
  vi.mocked(submitUpload).mockResolvedValue(partial);
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText(`Tiến độ: 9/200 WO đã xác nhận.`);
  expect(continueUpload).not.toHaveBeenCalled();
  expect(screen.queryByText('Tiếp tục upload toàn bộ nhóm')).not.toBeInTheDocument();
});

it('requires a status lookup when a chunk response makes no confirmed progress', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  vi.mocked(continueUpload).mockResolvedValue(receipt(10));
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Upload tự động đã dừng vì trạng thái chưa tiến triển an toàn. Kiểm tra trạng thái trước khi tiếp tục.');
  expect(continueUpload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Tiếp tục upload toàn bộ nhóm')).not.toBeInTheDocument();
});

it('keeps the current chunk but stops future chunks after permission is lost and restored', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  vi.mocked(getUploadStatus).mockResolvedValue(receipt(20));
  let resolveChunk!: (value: UploadStatus) => void;
  vi.mocked(continueUpload).mockReturnValueOnce(new Promise((resolve) => { resolveChunk = resolve; }));
  const view = render(<UploadPreviewControls {...baseProps} permitted />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByRole('button', { name: 'Dừng sau đợt đang gửi' });
  view.rerender(<UploadPreviewControls {...baseProps} permitted={false} />);
  view.rerender(<UploadPreviewControls {...baseProps} permitted />);
  resolveChunk(receipt(20));
  await screen.findByText('Tiến độ: 10/200 WO đã xác nhận.');
  expect(continueUpload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Tiếp tục upload toàn bộ nhóm')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Kiểm tra trạng thái'));
  await screen.findByText('Tiếp tục upload toàn bộ nhóm');
  expect(getUploadStatus).toHaveBeenCalledTimes(1);
});

it('keeps the finalized receipt and offers a refresh when the table refresh fails', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(200, true));
  const onUploadFinalized = vi.fn().mockResolvedValue(false);
  render(<UploadPreviewControls {...baseProps} onUploadFinalized={onUploadFinalized} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Kiểm tra lại phiên bản và Maximo trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Tiến độ: 200/200 WO đã xác nhận.');
  expect(await screen.findByText(/Maximo đã xác nhận thay đổi, nhưng bảng chưa được làm mới/)).toBeInTheDocument();
  expect(screen.getByText('Làm mới dữ liệu Maximo')).toBeInTheDocument();
  expect(onUploadFinalized).toHaveBeenCalledTimes(1);
});
