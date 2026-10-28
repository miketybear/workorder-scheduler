import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { continueUpload, getUploadStatus, previewUpload, reconcileUpload, submitUpload, UploadRejectedError, type Saved, type UploadPreview, type UploadStatus } from '../api/drafts';
import { UploadPreviewControls } from './UploadPreviewPanel';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), previewUpload: vi.fn(), submitUpload: vi.fn(), continueUpload: vi.fn(), getUploadStatus: vi.fn(), reconcileUpload: vi.fn() }));
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

it('treats a 409 as a definite rejection, keeps the draft, and allows a fresh preview without recovery', async () => {
  const onWorkflowRejected = vi.fn();
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockRejectedValueOnce(new UploadRejectedError('Work order already has an unresolved upload'));
  render(<UploadPreviewControls {...baseProps} onWorkflowRejected={onWorkflowRejected} />);
  fireEvent.click(screen.getByText(baseProps.previewLabel));
  await screen.findByRole('table');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Upload bị từ chối — Maximo chưa thay đổi: WO đang có lần upload chưa đối soát');
  expect(onWorkflowRejected).toHaveBeenCalledWith(expect.any(String));
  expect(screen.queryByText('Kết quả yêu cầu chưa xác định; dữ liệu nháp được giữ nguyên.')).not.toBeInTheDocument();
  expect(screen.queryByText('Lấy kết quả yêu cầu trước')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Ẩn đối chiếu'));
  expect(screen.getByText(baseProps.previewLabel)).toBeEnabled();
  fireEvent.click(screen.getByText(baseProps.previewLabel));
  await waitFor(() => expect(previewUpload).toHaveBeenCalledTimes(3));
  expect(submitUpload).toHaveBeenCalledTimes(1);
});

it('keeps receipt recovery after a network error during submit', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockRejectedValueOnce(new TypeError('network lost'));
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText(baseProps.previewLabel));
  await screen.findByRole('table');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Chưa xác định được kết quả. Kiểm tra kết quả yêu cầu trước khi tiếp tục; hệ thống sẽ giữ nguyên yêu cầu hiện tại.');
  expect(screen.getByText('Kết quả yêu cầu chưa xác định; dữ liệu nháp được giữ nguyên.')).toBeInTheDocument();
  expect(screen.getByText('Lấy kết quả yêu cầu trước')).toBeEnabled();
});

it('shows an in-flight upload without claiming Maximo is unchanged or the result is unknown', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  let resolveSubmit!: (value: UploadStatus) => void;
  vi.mocked(submitUpload).mockReturnValueOnce(new Promise((resolve) => { resolveSubmit = resolve; }));
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Đang xử lý yêu cầu upload và kiểm tra kết quả…');
  expect(submitUpload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.')).not.toBeInTheDocument();
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Kết quả chưa hoàn tất. Kiểm tra trạng thái để quyết định bước tiếp theo.');
  expect(continueUpload).not.toHaveBeenCalled();
});

it.each([1, 2, 50, 200])('reconciles unknown results for a %i-WO selection without retrying the original submit', async (count) => {
  const items = preview.items.slice(0, count);
  const selected = selection.slice(0, count);
  const uncertain = receipt(0);
  uncertain.items = selected.map((item, index) => ({ item_id: `unknown-${index}`, connection_id: 'conn', site_id: item.site_id,
    workorder_id: item.workorder_id, state: index === count - 1 ? 'unknown' : 'confirmed', updated_at: '2026-10-10T00:00:00Z',
    source: null, duration_result: null, restore_source: null }));
  uncertain.counts = { confirmed: count - 1, ...(count === 1 ? {} : {}), unknown: 1 };
  const resolved = { ...uncertain, source_finalized: false,
    items: uncertain.items.map((item, index) => ({ ...item, state: index === count - 1 ? 'conflict' as const : 'confirmed' as const })),
    counts: { confirmed: count - 1, conflict: 1 } };
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, items });
  vi.mocked(submitUpload).mockResolvedValue(uncertain);
  vi.mocked(getUploadStatus).mockResolvedValue(uncertain);
  vi.mocked(reconcileUpload).mockResolvedValue(resolved);
  render(<UploadPreviewControls {...baseProps} selection={selected} />);
  fireEvent.click(screen.getAllByRole('button')[0]!);
  await screen.findByRole('table');
  fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Upload'))!);
  await waitFor(() => expect(submitUpload).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent?.includes('WO'))!);
  await waitFor(() => expect(reconcileUpload).toHaveBeenCalledTimes(1));
  expect(submitUpload).toHaveBeenCalledTimes(1);
  expect(continueUpload).not.toHaveBeenCalled();
});

it.each([1, 2, 50, 200])('reports a mixed conflict result for a %i-WO selection without offering automatic continuation', async (count) => {
  const items = preview.items.slice(0, count);
  const selected = selection.slice(0, count);
  const partial = receipt(0);
  partial.items = selected.map((item, index) => ({ item_id: `mixed-${index}`, connection_id: 'conn', site_id: item.site_id,
    workorder_id: item.workorder_id, state: index === count - 1 ? 'conflict' : 'confirmed', updated_at: '2026-10-10T00:00:00Z',
    source: null, duration_result: null, restore_source: null }));
  partial.counts = { confirmed: count - 1, conflict: 1 };
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, items });
  vi.mocked(submitUpload).mockResolvedValue(partial);
  render(<UploadPreviewControls {...baseProps} selection={selected} />);
  fireEvent.click(screen.getAllByRole('button')[0]!);
  await screen.findByRole('table');
  fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Upload'))!);
  await waitFor(() => expect(submitUpload).toHaveBeenCalledTimes(1));
  const resultTable = screen.getAllByRole('table').at(-1)!;
  expect(within(resultTable).getAllByRole('row')).toHaveLength(count + 1);
  expect(continueUpload).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button').some((button) => button.textContent?.trim().startsWith('Tiếp tục'))).toBe(false);
});

it.each([1, 2, 50])('shows a finalized success receipt for a %i-WO selection', async (count) => {
  const items = preview.items.slice(0, count);
  const selected = selection.slice(0, count);
  const success = receipt(0, true);
  success.items = selected.map((item, index) => ({ item_id: `success-${index}`, connection_id: 'conn', site_id: item.site_id,
    workorder_id: item.workorder_id, state: 'confirmed', updated_at: '2026-10-10T00:00:00Z', source: null,
    duration_result: null, restore_source: null }));
  success.counts = { confirmed: count };
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, items });
  vi.mocked(submitUpload).mockResolvedValue(success);
  render(<UploadPreviewControls {...baseProps} selection={selected} uploadAll={false} />);
  fireEvent.click(screen.getAllByRole('button')[0]!);
  await screen.findByRole('table');
  fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Upload'))!);
  await waitFor(() => expect(submitUpload).toHaveBeenCalledTimes(1));
  expect(within(screen.getAllByRole('table').at(-1)!).getAllByRole('row')).toHaveLength(count + 1);
  expect(continueUpload).not.toHaveBeenCalled();
});

it('requires a status lookup after a timed out chunk before resuming with the same batch', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue(receipt(10));
  vi.mocked(continueUpload).mockRejectedValueOnce(new Error('Request timed out')).mockResolvedValue(receipt(200, true));
  vi.mocked(getUploadStatus).mockResolvedValue(receipt(10));
  render(<UploadPreviewControls {...baseProps} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
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
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  await screen.findByText('Tiến độ: 200/200 WO đã xác nhận.');
  expect(await screen.findByText(/Maximo đã xác nhận thay đổi, nhưng bảng chưa được làm mới/)).toBeInTheDocument();
  expect(screen.getByText('Làm mới dữ liệu Maximo')).toBeInTheDocument();
  expect(onUploadFinalized).toHaveBeenCalledTimes(1);
});

it('shows the upload steps, a production warning and grouped result counts', async () => {
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue({ ...receipt(9), counts: { confirmed: 9, pending: 190, failed: 1 },
    items: receipt(9).items.map((item, index) => index === 9 ? { ...item, state: 'failed' } : item) });
  render(<UploadPreviewControls {...baseProps} uploadAll={false} connection={{ label: 'Onshore prod', system: 'onshore', environment: 'production' }} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  const steps = screen.getByRole('list', { name: 'Các bước upload' });
  expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Đối chiếu');
  expect(screen.getByText(/thay đổi sẽ ghi vào Maximo thật/)).toHaveAttribute('data-env', 'production');
  fireEvent.click(screen.getByText(baseProps.buttonLabel));
  const summary = await screen.findByLabelText('Tóm tắt kết quả');
  expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Kết quả');
  expect(summary).toHaveTextContent('Hoàn tất 9');
  expect(summary).toHaveTextContent('Lỗi / xung đột 1');
  expect(summary).toHaveTextContent('Cần đối chiếu 190');
});

const wonumFor = (items: UploadPreview['items']) => items.map((item, index) => ({ ...item, wonum: `WO-${index + 1}` }));

it.each([1, 2, 50])('previews and lists the exact %i-WO selection without losing or duplicating rows', async (count) => {
  const items = Array.from({ length: count }, (_, index) => ({ site_id: 'BD1', workorder_id: String(index + 1), code: 'ready' as const,
    before: { estdur: '8' }, changes: { estdur: '9' }, warnings: [] }));
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, items });
  render(<UploadPreviewControls {...baseProps} selection={wonumFor(items)} />);
  fireEvent.click(screen.getAllByRole('button')[0]!);
  const table = within(await screen.findByRole('table'));
  expect(table.getAllByRole('row')).toHaveLength(count + 1);
  expect(table.getByRole('rowheader', { name: `WO-${count}` })).toBeInTheDocument();
  expect(screen.getByText((_, element) => element?.tagName === 'P' && !!element.textContent?.includes(`${count} WO`) && !!element.textContent?.includes('Maximo'))).toBeInTheDocument();
  expect(previewUpload).toHaveBeenCalledWith(expect.objectContaining({ draft_id: 'group', version: 2 }),
    items.map((item) => ({ site_id: item.site_id, workorder_id: item.workorder_id })), expect.any(AbortSignal));
});

it('shows one table with before → after per WO, a summary beside the Upload button and a verdict per row', async () => {
  const items: UploadPreview['items'] = [
    { site_id: 'BD1', workorder_id: '1', code: 'ready', before: { assignedto: null }, changes: { assignedto: 'LAMTH' }, warnings: [] },
    { site_id: 'BD1', workorder_id: '2', code: 'ready', before: { estdur: '8' }, changes: { estdur: '9' }, warnings: [] },
  ];
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, items });
  render(<UploadPreviewControls {...baseProps} selection={wonumFor(items)} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  const table = within(await screen.findByRole('table', { name: 'Thay đổi sẽ ghi' }));
  expect(screen.getByText('2 WO · 2 thay đổi · tất cả khớp với Maximo')).toBeInTheDocument();
  expect(table.getByRole('rowheader', { name: 'WO-1' })).toBeInTheDocument();
  expect(table.getByText(/Assigned PIC: — →/)).toHaveTextContent('Assigned PIC: — → LAMTH');
  expect(table.getByText(/Est. Duration: 8 →/)).toHaveTextContent('Est. Duration: 8 → 9');
  expect(table.getAllByText('Khớp')).toHaveLength(2);
  expect(screen.getByText(baseProps.buttonLabel)).toBeEnabled();
});

it('blocks the Upload button and counts the WOs to fix when one has a conflict', async () => {
  const items: UploadPreview['items'] = [
    { site_id: 'BD1', workorder_id: '1', code: 'ready', before: { estdur: '8' }, changes: { estdur: '9' }, warnings: [] },
    { site_id: 'BD1', workorder_id: '2', code: 'conflict', before: { estdur: '8' }, changes: { estdur: '10' }, warnings: [] },
  ];
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, items });
  render(<UploadPreviewControls {...baseProps} selection={wonumFor(items)} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  await screen.findByText('2 WO · 2 thay đổi · 1 WO cần xử lý');
  expect(screen.getByText('Xung đột')).toBeInTheDocument();
  expect(screen.getByText('Upload chưa khả dụng')).toBeDisabled();
  expect(screen.queryByText(baseProps.buttonLabel)).not.toBeInTheDocument();
});

it.each([
  { missing: ['schedule'] as ('schedule' | 'pic')[], label: 'Thiếu lịch' },
  { missing: ['pic'] as ('schedule' | 'pic')[], label: 'Thiếu PIC' },
  { missing: ['schedule', 'pic'] as ('schedule' | 'pic')[], label: 'Thiếu lịch và PIC' },
])('blocks a $label upload for both single and group drafts and explains the fix', async ({ missing, label }) => {
  const incomplete: UploadPreview['items'][number] = { site_id: 'BD1', workorder_id: '1', code: 'incomplete_schedule', missing,
    before: {}, changes: {}, warnings: [] };
  const complete: UploadPreview['items'][number] = { site_id: 'BD1', workorder_id: '2', code: 'ready',
    before: { estdur: '8' }, changes: { estdur: '9' }, warnings: [] };
  const groupItems = [incomplete, complete];
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, send_enabled: true, items: groupItems });
  const view = render(<UploadPreviewControls {...baseProps} selection={wonumFor(groupItems)} />);
  fireEvent.click(screen.getByText('Đối chiếu nhóm'));
  expect(await screen.findByText((_, element) => element?.tagName === 'TD' && element.textContent?.includes(label) === true)).toHaveTextContent(label);
  expect(screen.getByText(/Hoàn tất lịch\/PIC hoặc xóa WO khỏi nhóm trước khi upload/)).toBeInTheDocument();
  expect(screen.getByText('Upload chưa khả dụng')).toBeDisabled();
  expect(submitUpload).not.toHaveBeenCalled();

  view.unmount();
  vi.mocked(previewUpload).mockResolvedValue({ ...preview, send_enabled: true, items: [incomplete] });
  render(<UploadPreviewControls {...baseProps} selection={wonumFor([incomplete])} uploadAll={false} previewLabel="Đối chiếu upload" />);
  fireEvent.click(screen.getByText('Đối chiếu upload'));
  expect(await screen.findByText((_, element) => element?.tagName === 'TD' && element.textContent?.includes(label) === true)).toHaveTextContent(label);
  expect(screen.getByText('Upload chưa khả dụng')).toBeDisabled();
  expect(submitUpload).not.toHaveBeenCalled();
});
