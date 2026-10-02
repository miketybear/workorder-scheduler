import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getAuthSummary, type Session } from '../api/client';
import { columns, RetrievalError, retrieveWorkOrders, type WorkOrder } from '../api/workOrders';
import { WorkOrders } from './WorkOrders';
import { getDetail } from '../api/drafts';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn(), loginUrl: '/api/auth/login' }));
vi.mock('../api/workOrders', async (original) => ({ ...await original<object>(), retrieveWorkOrders: vi.fn() }));
vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), getDetail: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });
const session: Session = { user: { id: 'user', name: 'Planner', is_admin: false }, grants: [
  { connection_id: 'one', label: 'Onshore test', system: 'onshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'read' },
  { connection_id: 'two', label: 'Offshore test', system: 'offshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'write' },
] };
const row = { ...Object.fromEntries(columns.map(([field]) => [field, null])),
  siteid: 'SITE-A', wonum: 'WO-REAL', workorderid: '100', bdpocdiscipline: 'MECH',
  status: 'APPR', worktype: 'CM', targcompdate: '2026-09-30T23:00:00+07:00', wopriority: 0,
} as WorkOrder;
const editorDetail = { item: row, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'],
  baseline: { worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: null, estdur: '8',
    targstartdate: null, targcompdate: row.targcompdate } };

it('shows detail without crew configuration and blocks editing even for a writer', async () => {
  const select = await setup();
  fireEvent.change(select, { target: { value: JSON.stringify(['two', 'MECH']) } });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue({ ...editorDetail, allowed_pics: [], pics_configured: false });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  await screen.findByText(/Chưa cấu hình crew\/PIC/);
  expect(screen.getByLabelText('Est. Duration')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeDisabled();
});

async function setup() {
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session });
  render(<MemoryRouter><WorkOrders /></MemoryRouter>);
  const select = await screen.findByLabelText('Hệ thống / Discipline');
  fireEvent.change(select, { target: { value: JSON.stringify(['one', 'MECH']) } });
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('Target Finish trước'), { target: { value: '2026-10-01' } });
  return select;
}

it('shows all spreadsheet columns and distinct site identities without editing controls', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row, { ...row, siteid: 'SITE-B' }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('2 WO đã lấy đầy đủ.');
  expect(screen.getAllByText('WO-REAL')).toHaveLength(2);
  expect(screen.getAllByRole('columnheader')).toHaveLength(22);
  expect(screen.getByText('SITE-B')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('filters only retrieved rows by WO, description, tag and status without more requests', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([
    { ...row, wonum: 'WO-PUMP', description: 'Repair pump', location: 'TAG-01' },
    { ...row, workorderid: '101', wonum: 'WO-VALVE', status: 'WMATL', description: 'Repair valve', location: 'TAG-02' },
    { ...row, workorderid: '102', wonum: 'WO-NULL', description: null, location: null },
  ]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('3 WO đã lấy đầy đủ.');
  const search = screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name');
  for (const query of [' wo-pump ', 'PUMP', 'tag-01']) {
    fireEvent.change(search, { target: { value: query } });
    expect(screen.getByText(/Hiển thị 1 \/ 3 WO/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WO-PUMP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WO-VALVE' })).not.toBeInTheDocument();
  }
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'WMATL' } });
  expect(screen.getByText(/Không có WO khớp bộ lọc bảng/)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'WO từ Maximo' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'repair' } });
  expect(screen.getByRole('button', { name: 'WO-VALVE' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Xóa bộ lọc bảng'));
  expect(screen.getByText(/Hiển thị 3 \/ 3 WO/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WO-NULL' })).toBeInTheDocument();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('clears table filters and old scope data when the connection changes', async () => {
  const select = await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('1 WO đã lấy đầy đủ.');
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'no-match' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'APPR' } });
  fireEvent.change(select, { target: { value: JSON.stringify(['two', 'MECH']) } });
  expect(screen.queryByRole('search')).not.toBeInTheDocument();
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, wonum: 'WO-OFFSHORE' }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-OFFSHORE' });
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('');
  expect(screen.getByLabelText('Status')).toHaveValue('');
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
});

it('submits calendar dates as local midnight with the exclusive end unchanged', async () => {
  await setup();
  expect(screen.getByLabelText('Target Finish từ')).toHaveAttribute('type', 'date');
  expect(screen.getByLabelText('Target Finish trước')).toHaveAttribute('type', 'date');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('Không có WO trong phạm vi và khoảng ngày đã chọn.');
  expect(vi.mocked(retrieveWorkOrders).mock.calls[0][0]).toEqual({
    connection_id: 'one', discipline: 'MECH',
    target_from: '2026-09-01T00:00:00+07:00', target_before: '2026-10-01T00:00:00+07:00',
  });
});

it('ignores delayed results after switching connection', async () => {
  const select = await setup();
  let finish!: (rows: WorkOrder[]) => void;
  vi.mocked(retrieveWorkOrders).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText('Retrieve WO'));
  const signal = vi.mocked(retrieveWorkOrders).mock.calls[0][1];
  fireEvent.change(select, { target: { value: JSON.stringify(['two', 'MECH']) } });
  expect(signal.aborted).toBe(true);
  await act(async () => finish([row]));
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
});

it('clears old results on date changes and distinguishes retrieval errors from empty success', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('WO-REAL');
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-02' } });
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
  vi.mocked(retrieveWorkOrders).mockRejectedValue(new RetrievalError(502, 'Lỗi retrieve'));
  fireEvent.click(screen.getByText('Retrieve WO'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Lỗi retrieve');
  expect(screen.queryByText(/Không có WO trong/)).not.toBeInTheDocument();
});

it('clears results and controls when session is no longer valid', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('WO-REAL');
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: null });
  fireEvent(window, new Event('focus'));
  await screen.findByText('Đăng nhập Microsoft');
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
  expect(screen.queryByText('Retrieve WO')).not.toBeInTheDocument();
});

it('protects edits on scope and filter changes and preserves them across unchanged session checks', async () => {
  const select = await setup();
  fireEvent.change(select, { target: { value: JSON.stringify(['two', 'MECH']) } });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue({ item: row, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'],
    baseline: { worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: null, estdur: '8',
      targstartdate: null, targcompdate: row.targcompdate } });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByText('WO-REAL'));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.change(select, { target: { value: JSON.stringify(['one', 'MECH']) } });
  expect(select).toHaveValue(JSON.stringify(['two', 'MECH']));
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-02' } });
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, grants: [session.grants[0]] } });
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.queryByLabelText('Est. Duration')).not.toBeInTheDocument();
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
});

async function editWorkOrder() {
  const select = await setup();
  fireEvent.change(select, { target: { value: JSON.stringify(['two', 'MECH']) } });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByText('WO-REAL'));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
}

it('keeps edits hidden during a failed auth check and restores them after a successful retry', async () => {
  await editWorkOrder();
  vi.mocked(getAuthSummary).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.getByLabelText('Est. Duration')).not.toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Nội dung sửa đang được giữ ẩn');
  await act(async () => { fireEvent.click(screen.getByText('Kiểm tra lại phiên')); });
  expect(screen.getByLabelText('Est. Duration')).toBeVisible();
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
});

it('rechecks current work order state before revealing the editor and blocks a changed baseline', async () => {
  await editWorkOrder();
  vi.mocked(getDetail).mockResolvedValue({ ...editorDetail, baseline_token: 'b'.repeat(64),
    item: { ...row, estdur: '12' }, baseline: { ...editorDetail.baseline, estdur: '12' } });
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(screen.getByRole('table', { name: 'Thay đổi trước / sau' })).toHaveTextContent('Maximo hiện tại');
  expect(screen.getByRole('table', { name: 'Thay đổi trước / sau' })).toHaveTextContent('12');
});

it('clears the editor when the work order moves out of scope during recheck', async () => {
  await editWorkOrder();
  vi.mocked(getDetail).mockRejectedValue(new RetrievalError(404, 'WO không còn trong quyền truy cập'));
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(screen.queryByLabelText('Est. Duration')).not.toBeInTheDocument();
  expect(screen.getByText('Đăng nhập Microsoft')).toBeInTheDocument();
});

it('reopens the same work order after explicitly discarding edits', async () => {
  await editWorkOrder();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByText('WO-REAL'));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('8');
  expect(getDetail).toHaveBeenCalledTimes(2);
});
