import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getAuthSummary, getLiveness, type Session } from '../api/client';
import { columns, RetrievalError, retrieveWorkOrders, type WorkOrder } from '../api/workOrders';
import { WorkOrders } from './WorkOrders';
import { App } from '../App';
import { deleteDraft, getDetail, listPlannedWorkOrders, openBatch, openDraft, prepareBatch, saveBatch, saveDraft } from '../api/drafts';
import { getConnectionSettings, saveConnectionSetting } from '../api/settings';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn(), getLiveness: vi.fn().mockResolvedValue(true), loginUrl: '/api/auth/login' }));
vi.mock('../api/settings', () => ({ getConnectionSettings: vi.fn(), saveConnectionSetting: vi.fn() }));
vi.mock('../api/workOrders', async (original) => ({ ...await original<object>(), retrieveWorkOrders: vi.fn() }));
vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), getDetail: vi.fn(), prepareBatch: vi.fn(),
  openDraft: vi.fn(), openBatch: vi.fn(), saveDraft: vi.fn(), saveBatch: vi.fn(), deleteDraft: vi.fn(), listPlannedWorkOrders: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); vi.restoreAllMocks(); });
const session: Session = { user: { id: 'user', name: 'Planner', is_admin: false }, preferred_connection_id: 'one', grants: [
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

function returnToPage() {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
}

it('ignores window focus changes and rechecks only auth when returning to the tab, preserving edits and rows', async () => {
  await editWorkOrder();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'WO-REAL' } });
  // Filter changes clear selection; selecting afterwards must survive rechecks.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  fireEvent(window, new Event('blur')); fireEvent(window, new Event('focus'));
  expect(getAuthSummary).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i++) await act(async () => returnToPage());
  expect(getAuthSummary).toHaveBeenCalledTimes(4);
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(getDetail).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('WO-REAL');
  expect(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' })).toBeChecked();
});

it('deduplicates overlapping tab-return checks and keeps the existing table visible during verification', async () => {
  await editWorkOrder();
  let finish!: (result: { available: boolean; session: Session }) => void;
  vi.mocked(getAuthSummary).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  returnToPage(); returnToPage(); returnToPage();
  expect(getAuthSummary).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByLabelText('Est. Duration')).toBeVisible();
  await act(async () => finish({ available: true, session: { ...session, preferred_connection_id: 'two' } }));
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(getDetail).toHaveBeenCalledTimes(1);
});

it('does not cancel an in-flight save when hiding the tab and returning with unchanged access', async () => {
  await editWorkOrder();
  let finish!: (result: { draft_id: string; version: number; state: 'draft' }) => void;
  vi.mocked(saveDraft).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText('Lưu nháp'));
  const signal = vi.mocked(saveDraft).mock.calls[0][5];
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => returnToPage());
  expect(signal.aborted).toBe(false);
  await act(async () => finish({ draft_id: 'saved', version: 1, state: 'draft' }));
  expect(screen.getByText('Đã lưu nháp trên server. Maximo chưa thay đổi.')).toBeVisible();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(getDetail).toHaveBeenCalledTimes(1);
});

it('does not overwrite a just-saved plan with an older table response from a concurrent manual refresh', async () => {
  await editWorkOrder();
  let finish!: (items: WorkOrder[]) => void;
  vi.mocked(retrieveWorkOrders).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText('Cập nhật'));
  await waitFor(() => expect(retrieveWorkOrders).toHaveBeenCalledTimes(2));
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'new-plan', version: 1, state: 'draft' });
  fireEvent.click(screen.getByText('Lưu nháp'));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  await act(async () => finish([row]));
  expect(screen.getByRole('cell', { name: '9Nháp' })).toBeInTheDocument();
  expect(screen.getByText('Nháp · v1')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Nháp đã thay đổi trong lúc tải');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
});

it('retains batch edits across tab returns without repeating prepare or restore reads', async () => {
  await setup(false, 'two');
  const second = { ...row, workorderid: '101', wonum: 'WO-SECOND' };
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row, second]);
  vi.mocked(prepareBatch).mockResolvedValue([editorDetail, { ...editorDetail, item: second }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-SECOND' });
  fireEvent.click(screen.getByLabelText('Chọn tất cả 2 WO trong kết quả lọc đã tải'));
  fireEvent.click(screen.getByText('Lập lịch nhóm (2)'));
  fireEvent.change(await screen.findByLabelText('WO-SECOND Est. Duration'), { target: { value: '9' } });
  await act(async () => returnToPage());
  expect(screen.getByLabelText('WO-SECOND Est. Duration')).toHaveValue('9');
  expect(prepareBatch).toHaveBeenCalledTimes(1);
  expect(openBatch).not.toHaveBeenCalled();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it.each(['single', 'batch'])('releases the page scroll lock when closing or unmounting the %s panel', async (kind) => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  vi.mocked(prepareBatch).mockResolvedValue([editorDetail]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  expect(document.documentElement).not.toHaveAttribute('data-wo-panel-open');
  function open() {
    if (kind === 'single') fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
    else {
      const checkbox = screen.getByLabelText('Chọn WO-REAL · dòng 1');
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
      fireEvent.click(screen.getByText('Lập lịch nhóm (1)'));
    }
  }
  open();
  const closeLabel = kind === 'single' ? 'Đóng nháp' : 'Đóng nhóm';
  await screen.findByLabelText(kind === 'single' ? 'Est. Duration' : 'WO-REAL Est. Duration');
  await waitFor(() => expect(screen.getByRole('button', { name: closeLabel })).toBeEnabled());
  expect(document.documentElement).toHaveAttribute('data-wo-panel-open');
  fireEvent.click(screen.getByRole('button', { name: closeLabel }));
  expect(document.documentElement).not.toHaveAttribute('data-wo-panel-open');
  open();
  await waitFor(() => expect(document.documentElement).toHaveAttribute('data-wo-panel-open'));
  // Unmount cleanup also covers a removed workspace, without relying on its close button.
  cleanup();
  expect(document.documentElement).not.toHaveAttribute('data-wo-panel-open');
});

it('unlocks other routes and restores the lock only when returning to the retained editor', async () => {
  await setup(true, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  vi.mocked(getConnectionSettings).mockResolvedValue({ session: { ...session, preferred_connection_id: 'two' },
    connections: [{ connection_id: 'two', url: 'https://offshore.invalid/maximo' }] });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  expect(document.documentElement).toHaveAttribute('data-wo-panel-open');
  fireEvent.click(screen.getByRole('link', { name: 'Settings · Hệ thống' }));
  await screen.findByRole('radio', { name: /Offshore test/ });
  expect(document.documentElement).not.toHaveAttribute('data-wo-panel-open');
  fireEvent.click(screen.getByRole('link', { name: '← Work Orders' }));
  await screen.findByLabelText('Est. Duration');
  expect(document.documentElement).toHaveAttribute('data-wo-panel-open');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: null });
  await act(async () => returnToPage());
  await screen.findByText('Đăng nhập Microsoft');
  expect(document.documentElement).not.toHaveAttribute('data-wo-panel-open');
});

it('marks a five-minute-old table stale without refetching and refreshes only when requested', async () => {
  await setup();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  await act(async () => fireEvent.click(screen.getByText('Retrieve WO')));
  expect(screen.getByText(/Cập nhật lần cuối:/)).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(5 * 60 * 1000));
  expect(screen.getByText('Dữ liệu có thể đã thay đổi.')).toBeInTheDocument();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Dữ liệu có thể đã thay đổi.')).not.toBeInTheDocument();
});

it('retains the WO table, selection, panel edits and scroll position across Settings navigation', async () => {
  await setup(true, 'two');
  vi.mocked(getConnectionSettings).mockResolvedValue({ session: { ...session, preferred_connection_id: 'two' },
    connections: [{ connection_id: 'two', url: 'https://offshore.invalid/maximo' }] });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]); vi.mocked(getDetail).mockResolvedValue(editorDetail);
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  const confirm = vi.spyOn(window, 'confirm');
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(240);
  fireEvent(window, new Event('scroll'));
  fireEvent.click(screen.getByRole('link', { name: 'Settings · Hệ thống' }));
  await screen.findByRole('radio', { name: /Offshore test/ });
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: '← Work Orders' }));
  await screen.findByRole('button', { name: 'WO-REAL' });
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' })).toBeChecked();
  expect(scrollTo).toHaveBeenCalledWith(0, 240);
  expect(getDetail).toHaveBeenCalledTimes(1);
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('requires discarding edits before switching the saved connection and clears the old workspace on return', async () => {
  await setup(true, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]); vi.mocked(getDetail).mockResolvedValue(editorDetail);
  vi.mocked(getConnectionSettings).mockResolvedValue({ session: { ...session, preferred_connection_id: 'two' }, connections: [
    { connection_id: 'one', url: 'https://onshore.invalid/maximo' }, { connection_id: 'two', url: 'https://offshore.invalid/maximo' }] });
  vi.mocked(saveConnectionSetting).mockResolvedValue();
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('link', { name: 'Settings · Hệ thống' }));
  fireEvent.click(await screen.findByRole('radio', { name: /Onshore test/ }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByText('Lưu hệ thống'));
  expect(saveConnectionSetting).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText('Lưu hệ thống'));
  await screen.findByText(/Đã lưu hệ thống cho tài khoản/);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session });
  fireEvent.click(screen.getByRole('link', { name: '← Work Orders' }));
  await screen.findByText(/Onshore test · onshore · test \/ MECH/);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
});

it('shows detail without crew configuration and blocks editing even for a writer', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue({ ...editorDetail, allowed_pics: [], pics_configured: false });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  await screen.findByText(/Chưa cấu hình crew\/PIC/);
  expect(screen.getByLabelText('Est. Duration')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeDisabled();
});

async function setup(withApp = false, connectionId = 'one') {
  vi.mocked(getLiveness).mockResolvedValue(true);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, preferred_connection_id: connectionId } });
  render(<MemoryRouter initialEntries={['/work-orders']}>{withApp ? <App /> : <WorkOrders />}</MemoryRouter>);
  await screen.findByText(/Có thể chỉnh sửa và lưu nháp|Chỉ xem/);
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('Target Finish trước'), { target: { value: '2026-10-01' } });
  expect(screen.queryByLabelText('Hệ thống / Discipline')).not.toBeInTheDocument();
}

async function chooseConnection(connectionId: string) {
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, preferred_connection_id: connectionId } });
  await act(async () => returnToPage());
}

it('switches light/dark in the app without refetching WO or losing unsaved panel edits', async () => {
  localStorage.removeItem('workorder-scheduler-theme');
  await setup(true, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  const requests = [vi.mocked(getAuthSummary).mock.calls.length, vi.mocked(retrieveWorkOrders).mock.calls.length, vi.mocked(getDetail).mock.calls.length];
  const toggle = screen.getByRole('switch', { name: 'Chế độ tối' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(document.documentElement.dataset.theme).toBe('g100');
  expect(localStorage.getItem('workorder-scheduler-theme')).toBe('g100');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  fireEvent.click(toggle);
  expect(document.documentElement.dataset.theme).toBe('g10');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect([vi.mocked(getAuthSummary).mock.calls.length, vi.mocked(retrieveWorkOrders).mock.calls.length, vi.mocked(getDetail).mock.calls.length]).toEqual(requests);
  localStorage.removeItem('workorder-scheduler-theme');
});

it('keeps seven compact columns and hides system, site and WOID while preserving distinct identities', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, systemid: 'HT-98-MISC-SYSTEM' }, { ...row, siteid: 'SITE-B', systemid: 'MT1-61-INSTR-AIR-SYS' }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('2 WO đã lấy đầy đủ.');
  expect(screen.getAllByText('WO-REAL')).toHaveLength(2);
  expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  expect(screen.queryByLabelText('System')).not.toBeInTheDocument();
  expect(screen.queryByText('HT-98-MISC-SYSTEM')).not.toBeInTheDocument();
  expect(screen.queryByText('MT1-61-INSTR-AIR-SYS')).not.toBeInTheDocument();
  expect(screen.queryByText('WOID')).not.toBeInTheDocument();
  expect(screen.queryByText('SITE-B')).not.toBeInTheDocument();
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
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('1 WO đã lấy đầy đủ.');
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'no-match' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'APPR' } });
  await chooseConnection('two');
  expect(screen.queryByRole('search')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
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
  await setup();
  let finish!: (rows: WorkOrder[]) => void;
  vi.mocked(retrieveWorkOrders).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText('Retrieve WO'));
  const signal = vi.mocked(retrieveWorkOrders).mock.calls[0][1];
  await chooseConnection('two');
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
  returnToPage();
  await screen.findByText('Đăng nhập Microsoft');
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
  expect(screen.queryByText('Retrieve WO')).not.toBeInTheDocument();
});

it('protects edits on scope and filter changes and preserves them across unchanged session checks', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue({ item: row, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'],
    baseline: { worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: null, estdur: '8',
      targstartdate: null, targcompdate: row.targcompdate } });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByText('WO-REAL'));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('link', { name: 'Settings · Hệ thống' }));
  expect(screen.getByText(/Offshore test · offshore · test \/ MECH/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-02' } });
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  await act(async () => { returnToPage(); });
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, grants: [session.grants[0]] } });
  await act(async () => { returnToPage(); });
  expect(screen.queryByLabelText('Est. Duration')).not.toBeInTheDocument();
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
});

async function editWorkOrder() {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByText('WO-REAL'));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '9' } });
}

it('keeps a saved draft reachable after closing without refreshing or deleting it', async () => {
  await editWorkOrder();
  const saved = { draft_id: 'saved', version: 1, state: 'draft' as const };
  vi.mocked(saveDraft).mockResolvedValue(saved);
  vi.mocked(openDraft).mockResolvedValue({ ...editorDetail, ...saved, changes: { estdur: '9' },
    baseline_changed: false, changes_valid_now: true });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  const authCalls = vi.mocked(getAuthSummary).mock.calls.length;
  fireEvent.click(screen.getByText('Đóng nháp'));
  // Removing focused panel controls may produce focus without a real window departure.
  await act(async () => fireEvent(window, new Event('focus')));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Nháp · v1')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'WO từ Maximo' })).getByRole('cell', { name: '9Nháp' })).toHaveAttribute('data-draft', 'true');
  expect(screen.queryByRole('button', { name: 'Danh sách nháp' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(getAuthSummary).toHaveBeenCalledTimes(authCalls);
  expect(deleteDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('9');
  expect(openDraft).toHaveBeenCalledWith('saved', { connection_id: 'two', discipline: 'MECH' }, expect.any(AbortSignal));
  // A returned grant change still clears the shortcut and operational content.
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, grants: [session.grants[0]] } });
  await act(async () => returnToPage());
  expect(screen.queryByText('Nháp · v1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
});

it('protects unsaved closing and does not treat panel focus as leaving the page', async () => {
  await editWorkOrder();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByText('Đóng nháp'));
  await act(async () => fireEvent(window, new Event('focus')));
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(saveDraft).not.toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
  expect(getAuthSummary).toHaveBeenCalledTimes(1);
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByText('Đóng nháp'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Mở lại nháp đã lưu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
});

it('rechecks once when returning from a hidden tab followed by window focus', async () => {
  await setup();
  let hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  fireEvent(document, new Event('visibilitychange'));
  hidden = false;
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));
  });
  expect(getAuthSummary).toHaveBeenCalledTimes(2);
});

it('keeps a saved group accessible after closing and reopens the batch API', async () => {
  await setup(false, 'two');
  const second = { ...row, workorderid: '101', wonum: 'WO-SECOND' };
  const details = [editorDetail, { ...editorDetail, item: second }];
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row, second]);
  vi.mocked(prepareBatch).mockResolvedValue(details);
  const saved = { draft_id: 'group', version: 2, state: 'draft' as const };
  vi.mocked(saveBatch).mockResolvedValue(saved);
  vi.mocked(openBatch).mockResolvedValue({ ...saved, items: details.map((item) => ({ ...item, changes: { estdur: '9' } })) });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-SECOND' });
  fireEvent.click(screen.getByLabelText('Chọn tất cả 2 WO trong kết quả lọc đã tải'));
  fireEvent.click(screen.getByText('Lập lịch nhóm (2)'));
  await screen.findByLabelText('WO-REAL Est. Duration');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Est. Duration' }));
  fireEvent.change(screen.getByLabelText('Nhóm Est. Duration'), { target: { value: '9' } });
  fireEvent.click(screen.getByText('Áp dụng vào nháp'));
  fireEvent.click(screen.getByText('Xem trước thay đổi'));
  fireEvent.click(screen.getByText('Lưu nháp nhóm'));
  await screen.findByText('Đã lưu nháp 2 WO · v2. Maximo chưa thay đổi.');
  fireEvent.click(screen.getByText('Đóng nhóm'));
  await act(async () => fireEvent(window, new Event('focus')));
  expect(screen.getAllByText('Nháp nhóm · v2')).toHaveLength(2);
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'WO-SECOND' }));
  expect(await screen.findByLabelText('WO-SECOND Est. Duration')).toHaveValue('9');
  expect(openBatch).toHaveBeenCalledWith('group', { connection_id: 'two', discipline: 'MECH' }, expect.any(AbortSignal));
  fireEvent.click(screen.getByText('Đóng nhóm'));
  fireEvent.click(screen.getByText('Lập lịch nhóm (2)'));
  await screen.findByLabelText('WO-SECOND Est. Duration');
  expect(prepareBatch).toHaveBeenCalledTimes(1);
});

const marker = { draft_id: 'draft-one', version: 1, is_batch: false, updated_at: '2026-10-06T09:00:00+07:00',
  baseline_changed: false, changes: { estdur: '9', assignedtechname: 'TECH' } };

async function openSavedDraft() {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, estdur: '8', drafts: [marker] }]);
  vi.mocked(openDraft).mockResolvedValue({ ...editorDetail, item: { ...row, estdur: '8' }, draft_id: marker.draft_id, version: 1, state: 'draft',
    changes: marker.changes, baseline_changed: false, changes_valid_now: true });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  await screen.findByLabelText('Est. Duration');
}

it('deletes a saved draft without a native dialog or resetting login, query, filters or the WO table', async () => {
  await openSavedDraft();
  const confirm = vi.spyOn(window, 'confirm');
  let finish!: () => void;
  vi.mocked(deleteDraft).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'WO-REAL' } });
  fireEvent.click(screen.getByText('Xóa nháp'));
  expect(deleteDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  expect(screen.getByText('Đóng nháp')).toBeDisabled();
  await act(async () => finish());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '8' })).toBeInTheDocument();
  expect(screen.queryByText('Nháp · v1')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('WO-REAL');
  expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
  expect(getAuthSummary).toHaveBeenCalledTimes(1);
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(openDraft).mockRejectedValue(new RetrievalError(404, 'Deleted draft'));
  await act(async () => returnToPage());
  expect(openDraft).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
});

it('closes a draft deleted in another tab on explicit update without signing out', async () => {
  await openSavedDraft();
  vi.mocked(openDraft).mockRejectedValue(new RetrievalError(404, 'Deleted draft'));
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Nháp · v1')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('WO hoặc nháp không còn tồn tại');
});

it.each(['success', 'missing'])('ignores a delayed draft recheck after closing the panel: %s', async (outcome) => {
  await openSavedDraft();
  let finish!: () => void;
  const restored = await vi.mocked(openDraft).mock.results[0].value;
  vi.mocked(openDraft).mockReturnValue(new Promise((resolve, reject) => {
    finish = () => outcome === 'missing' ? reject(new RetrievalError(404, 'Deleted draft')) : resolve(restored);
  }));
  fireEvent.click(screen.getByText('Cập nhật'));
  await waitFor(() => expect(openDraft).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng nháp', hidden: true }));
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  await act(async () => finish());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('rechecks the real session after a denied delete instead of interpreting resource 404 as logout', async () => {
  await openSavedDraft();
  vi.mocked(deleteDraft).mockRejectedValue(new RetrievalError(404, 'Deleted draft'));
  fireEvent.click(screen.getByText('Xóa nháp'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  await waitFor(() => expect(getAuthSummary).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retrieve WO' })).toBeVisible();
});

it('requires login when the session actually expired during deletion', async () => {
  await openSavedDraft();
  vi.mocked(deleteDraft).mockRejectedValue(new RetrievalError(401, 'Expired session'));
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: null });
  fireEvent.click(screen.getByText('Xóa nháp'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  await screen.findByText('Đăng nhập Microsoft');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
});

it('clears protected WO data after revoked delete access while retaining the authenticated account', async () => {
  await openSavedDraft();
  vi.mocked(deleteDraft).mockRejectedValue(new RetrievalError(403, 'Access revoked'));
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, grants: [] } });
  fireEvent.click(screen.getByText('Xóa nháp'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  await screen.findByText('Chưa được cấp quyền WO. Vui lòng liên hệ quản trị viên.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
});

it('filters saved plans and opens their exact ID without requesting a new baseline', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, drafts: [marker] }, { ...row, workorderid: '101', wonum: 'NO-DRAFT' }]);
  vi.mocked(openDraft).mockResolvedValue({ ...editorDetail, draft_id: marker.draft_id, version: 1, state: 'draft',
    changes: marker.changes, baseline_changed: false, changes_valid_now: true });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('2 WO đã lấy đầy đủ.');
  expect(screen.getByRole('cell', { name: 'TECHNháp' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Nháp'), { target: { value: 'yes' } });
  expect(screen.queryByRole('button', { name: 'NO-DRAFT' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  await screen.findByLabelText('Est. Duration');
  expect(openDraft).toHaveBeenCalledWith(marker.draft_id, { connection_id: 'one', discipline: 'MECH' }, expect.any(AbortSignal));
  expect(getDetail).not.toHaveBeenCalled();
});

it('requires a choice for competing plans and preserves other plans when one is deleted', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, estdur: '8', drafts: [marker, { ...marker, draft_id: 'second', version: 2, changes: { estdur: '10' } }] }]);
  vi.mocked(openDraft).mockResolvedValue({ ...editorDetail, draft_id: 'second', version: 2, state: 'draft',
    changes: { estdur: '10' }, baseline_changed: false, changes_valid_now: true });
  vi.mocked(deleteDraft).mockResolvedValue();
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('2 nháp · chọn để mở');
  expect(screen.getByRole('cell', { name: '8' })).not.toHaveAttribute('data-draft', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  expect(openDraft).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Chọn nháp của WO' })).toHaveFocus();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Chọn nháp của WO' })).getByRole('button', { name: /Nháp · v2/ }));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('10');
  fireEvent.click(screen.getByText('Xóa nháp'));
  expect(deleteDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  await screen.findByText('Nháp · v1');
  expect(screen.queryByText('2 nháp · chọn để mở')).not.toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '9Nháp' })).toBeInTheDocument();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('shows current Maximo values with a review marker when a saved baseline is stale', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, estdur: '8', drafts: [{ ...marker, baseline_changed: true }] }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText(/Nháp · v1 · Cần đối chiếu/);
  expect(screen.getByRole('cell', { name: '8' })).not.toHaveAttribute('data-draft', 'true');
  expect(screen.queryByRole('cell', { name: 'TECHNháp' })).not.toBeInTheDocument();
});

it('uses the same WO table for drafts outside the Retrieve range and rechecks that page on return', async () => {
  await setup();
  const planned = { ...row, drafts: [marker] };
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [planned], next_offset: 20 });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByRole('button', { name: 'WO-REAL' });
  expect(retrieveWorkOrders).not.toHaveBeenCalled();
  expect(listPlannedWorkOrders).toHaveBeenCalledWith({ connection_id: 'one', discipline: 'MECH' }, 0, expect.any(AbortSignal));
  expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...planned, wonum: 'OUTSIDE-RANGE' }], next_offset: null });
  fireEvent.click(screen.getByText('Trang tiếp'));
  await screen.findByRole('button', { name: 'OUTSIDE-RANGE' });
  expect(listPlannedWorkOrders).toHaveBeenLastCalledWith({ connection_id: 'one', discipline: 'MECH' }, 20, expect.any(AbortSignal));
  await act(async () => returnToPage());
  expect(listPlannedWorkOrders).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'OUTSIDE-RANGE' })).toBeVisible();
});

it('restores separate source tables, filters, selection and timestamps without refetching', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...row, workorderid: '200', wonum: 'DRAFT-ONLY', drafts: [marker] }], next_offset: null });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'REAL' } });
  fireEvent.click(screen.getByLabelText('Chọn WO-REAL · dòng 1'));
  const timestamp = screen.getByText(/Cập nhật lần cuối:/).textContent;
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByRole('button', { name: 'DRAFT-ONLY' });
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'DRAFT' } });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('REAL');
  expect(screen.getByLabelText('Chọn WO-REAL · dòng 1')).toBeChecked();
  expect(screen.getByText(/Cập nhật lần cuối:/)).toHaveTextContent(timestamp!);
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  expect(screen.getByRole('button', { name: 'DRAFT-ONLY' })).toBeVisible();
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('DRAFT');
  expect(listPlannedWorkOrders).toHaveBeenCalledTimes(1);
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('restores the draft page and uses the restored source query for explicit refresh', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(listPlannedWorkOrders).mockResolvedValueOnce({ items: [{ ...row, drafts: [marker] }], next_offset: 20 })
    .mockResolvedValue({ items: [{ ...row, wonum: 'PAGE-TWO', drafts: [marker] }], next_offset: null });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  const query = vi.mocked(retrieveWorkOrders).mock.calls[0][0];
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await waitFor(() => expect(screen.getByText('Trang tiếp')).toBeEnabled());
  fireEvent.click(screen.getByText('Trang tiếp'));
  await screen.findByRole('button', { name: 'PAGE-TWO' });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(retrieveWorkOrders).toHaveBeenLastCalledWith(query, expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  expect(screen.getByRole('button', { name: 'PAGE-TWO' })).toBeVisible();
  expect(screen.getByText(/Nháp của tôi · trang 2/)).toBeVisible();
  expect(screen.getByText('Trang tiếp')).toBeDisabled();
  expect(listPlannedWorkOrders).toHaveBeenCalledTimes(2);
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(listPlannedWorkOrders).toHaveBeenLastCalledWith({ connection_id: 'one', discipline: 'MECH' }, 20, expect.any(AbortSignal));
});

it('restores the age warning even when both sources have the same retrieval timestamp', async () => {
  await setup();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...row, drafts: [marker] }], next_offset: null });
  await act(async () => fireEvent.click(screen.getByText('Retrieve WO')));
  await act(async () => fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } }));
  await act(async () => vi.advanceTimersByTimeAsync(5 * 60 * 1000));
  expect(screen.getByText('Dữ liệu có thể đã thay đổi.')).toBeVisible();
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('Dữ liệu có thể đã thay đổi.')).toBeVisible();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(listPlannedWorkOrders).toHaveBeenCalledTimes(1);
});

it('updates the hidden Maximo snapshot after deleting a draft from the drafts source', async () => {
  await openSavedDraft();
  fireEvent.click(screen.getByText('Đóng nháp'));
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...row, estdur: '8', drafts: [marker] }], next_offset: null });
  vi.mocked(deleteDraft).mockResolvedValue();
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  await screen.findByLabelText('Est. Duration');
  fireEvent.click(screen.getByText('Xóa nháp'));
  fireEvent.click(screen.getByText('Xác nhận xóa nháp'));
  await screen.findByText('Không có WO có nháp khả dụng trong trang này.');
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '8' })).toBeInTheDocument();
  expect(screen.queryByText('Nháp · v1')).not.toBeInTheDocument();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('updates a hidden source snapshot after saving a newer draft version', async () => {
  await openSavedDraft();
  fireEvent.click(screen.getByText('Đóng nháp'));
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...row, estdur: '8', drafts: [marker] }], next_offset: null });
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: marker.draft_id, version: 2, state: 'draft' });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  fireEvent.change(await screen.findByLabelText('Est. Duration'), { target: { value: '11' } });
  fireEvent.click(screen.getByText('Lưu nháp'));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  expect(screen.getByText('Nháp · v2')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '11Nháp' })).toBeInTheDocument();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('clears both source snapshots after a connection change', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...row, wonum: 'OLD-DRAFT', drafts: [marker] }], next_offset: null });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByRole('button', { name: 'OLD-DRAFT' });
  await chooseConnection('two');
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [], next_offset: null });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByText('Không có WO có nháp khả dụng trong trang này.');
  expect(screen.queryByRole('button', { name: 'OLD-DRAFT' })).not.toBeInTheDocument();
  expect(listPlannedWorkOrders).toHaveBeenLastCalledWith({ connection_id: 'two', discipline: 'MECH' }, 0, expect.any(AbortSignal));
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
});

it('preserves Maximo data after a failed draft load and retries the failed source on returning', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(listPlannedWorkOrders).mockRejectedValueOnce(new RetrievalError(502, 'Upstream unavailable'))
    .mockResolvedValue({ items: [], next_offset: null });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByText('Không có WO có nháp khả dụng trong trang này.');
  expect(listPlannedWorkOrders).toHaveBeenCalledTimes(2);
});

it('keeps the current source and unsaved edits when discarding is declined', async () => {
  await editWorkOrder();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  expect(screen.getByLabelText('Nguồn WO')).toHaveValue('maximo');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(listPlannedWorkOrders).not.toHaveBeenCalled();
});

it('changing the date range invalidates only Maximo results and retains the drafts source', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  vi.mocked(listPlannedWorkOrders).mockResolvedValue({ items: [{ ...row, wonum: 'DRAFT-ONLY', drafts: [marker] }], next_offset: null });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  await screen.findByRole('button', { name: 'DRAFT-ONLY' });
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-08-01' } });
  expect(screen.getByRole('button', { name: 'DRAFT-ONLY' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'maximo' } });
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  expect(screen.getByText(/Chưa Retrieve WO cho khoảng ngày này/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  expect(screen.getByRole('button', { name: 'DRAFT-ONLY' })).toBeVisible();
  expect(listPlannedWorkOrders).toHaveBeenCalledTimes(1);
});

it('discards delayed planned rows on a scope change', async () => {
  await setup();
  let finish!: (result: { items: WorkOrder[]; next_offset: null }) => void;
  vi.mocked(listPlannedWorkOrders).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText('Nguồn WO'), { target: { value: 'drafts' } });
  const signal = vi.mocked(listPlannedWorkOrders).mock.calls[0][2];
  await chooseConnection('two');
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ items: [{ ...row, drafts: [marker] }], next_offset: null }));
  expect(screen.queryByText('WO-REAL')).not.toBeInTheDocument();
});

it('does not silently create another batch over a mixture of saved plans and unscheduled WOs', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, drafts: [marker] }, { ...row, workorderid: '101', wonum: 'NEW-WO' }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'NEW-WO' });
  fireEvent.click(screen.getByLabelText('Chọn tất cả 2 WO trong kết quả lọc đã tải'));
  fireEvent.click(screen.getByText('Lập lịch nhóm (2)'));
  expect(screen.getByRole('alert')).toHaveTextContent('Có WO đã có nháp');
  expect(prepareBatch).not.toHaveBeenCalled();
});

it('keeps edits hidden during a failed auth check and restores them after a successful retry', async () => {
  await editWorkOrder();
  vi.mocked(getAuthSummary).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => { returnToPage(); });
  expect(screen.getByLabelText('Est. Duration')).not.toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Nội dung sửa đang được giữ ẩn');
  await act(async () => { fireEvent.click(screen.getByText('Kiểm tra lại phiên')); });
  expect(screen.getByLabelText('Est. Duration')).toBeVisible();
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeInTheDocument();
});

it('preserves edits during explicit updates and blocks a changed baseline', async () => {
  await editWorkOrder();
  vi.mocked(getDetail).mockResolvedValue({ ...editorDetail, baseline_token: 'b'.repeat(64),
    item: { ...row, estdur: '12' }, baseline: { ...editorDetail.baseline, estdur: '12' } });
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByText('Lưu nháp')).toBeDisabled();
  expect(screen.getByRole('table', { name: 'Thay đổi trước / sau' })).toHaveTextContent('Maximo hiện tại');
  expect(screen.getByRole('table', { name: 'Thay đổi trước / sau' })).toHaveTextContent('12');
});

it('rechecks the session after access expires during a manual data refresh', async () => {
  await editWorkOrder();
  vi.mocked(getDetail).mockRejectedValue(new RetrievalError(401, 'Session expired'));
  vi.mocked(getAuthSummary).mockResolvedValueOnce({ available: true, session: { ...session, preferred_connection_id: 'two' } })
    .mockResolvedValue({ available: true, session: null });
  fireEvent.click(screen.getByText('Cập nhật'));
  await screen.findByText('Đăng nhập Microsoft');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
});

it('clears the editor when the work order moves out of scope during recheck', async () => {
  await editWorkOrder();
  vi.mocked(getDetail).mockRejectedValue(new RetrievalError(404, 'WO không còn trong quyền truy cập'));
  vi.mocked(retrieveWorkOrders).mockResolvedValue([]);
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(screen.queryByLabelText('Est. Duration')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('WO hoặc nháp không còn tồn tại');
  expect(screen.getByText(/Có thể chỉnh sửa và lưu nháp/)).toBeVisible();
});

it('reopens the same work order after explicitly discarding edits', async () => {
  await editWorkOrder();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('8');
  expect(getDetail).toHaveBeenCalledTimes(2);
});

it('selects only filtered retrieved WOs from a monthly list and resets selection on filter changes', async () => {
  await setup(false, 'two');
  const monthly = Array.from({ length: 100 }, (_, i) => ({ ...row, workorderid: String(100 + i), wonum: `WO-${i}`,
    status: i < 20 ? 'WMATL' : 'APPR' }));
  vi.mocked(retrieveWorkOrders).mockResolvedValue(monthly);
  vi.mocked(prepareBatch).mockResolvedValue([]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('100 WO đã lấy đầy đủ.');
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'WMATL' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả 20 WO trong kết quả lọc đã tải' }));
  expect(screen.getByText('Lập lịch nhóm (20)')).toBeEnabled();
  fireEvent.click(screen.getByText('Lập lịch nhóm (20)'));
  await act(async () => {});
  expect(vi.mocked(prepareBatch).mock.calls[0][1]).toHaveLength(20);
  expect(vi.mocked(prepareBatch).mock.calls[0][1][0]).toEqual({ site_id: 'SITE-A', workorder_id: '100' });
  fireEvent.click(screen.getByText('Đóng nhóm'));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'APPR' } });
  expect(screen.getByText('Lập lịch nhóm (0)')).toBeDisabled();
});

it('does not refresh or disturb retrieval state while the user remains on the page', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'WO-REAL' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  const authCalls = vi.mocked(getAuthSummary).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(180000); });
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(getAuthSummary).toHaveBeenCalledTimes(authCalls);
  expect(screen.getByText(/Offshore test · offshore · test \/ MECH/)).toBeInTheDocument();
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  expect(screen.getByLabelText('Target Finish trước')).toHaveValue('2026-10-01');
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('WO-REAL');
  expect(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
});

it('replaces old list data with the fresh scoped response and drops disappeared selections', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValueOnce([row]).mockResolvedValue([]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(screen.queryByRole('button', { name: 'WO-REAL' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
  expect(screen.getByText(/Offshore test · offshore · test \/ MECH/)).toBeInTheDocument();
});

it('keeps the verified snapshot visible after a failed explicit update and preserves filters after retry', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValueOnce([row]).mockRejectedValueOnce(new RetrievalError(502, 'Offline')).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Không cập nhật được dữ liệu');
  await act(async () => fireEvent.click(screen.getByText('Cập nhật')));
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01');
});

it('shows every business data field in the panel while hiding technical identity and system', async () => {
  await setup();
  const rich = { ...row, lead: 'ONSHORE', wolo10: '25', systemid: 'HT-98-MISC-SYSTEM',
    actstart: '2026-09-29T01:00:00Z', actfinish: '2026-09-29T02:00:00Z',
    targstartdate: '2026-09-30T08:00:00+07:00', wopriority: 2, wopriority_description: 'Medium' };
  vi.mocked(retrieveWorkOrders).mockResolvedValue([rich]);
  vi.mocked(getDetail).mockResolvedValue({ ...editorDetail, item: rich });
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  await screen.findByText('ONSHORE');
  const panel = within(screen.getByRole('dialog', { name: 'Chỉnh sửa nháp' }));
  expect(panel.getByText('25%')).toBeVisible();
  expect(panel.getByText('29/09/2026, 08:00')).not.toBeVisible();
  fireEvent.click(panel.getByText('Lịch Maximo và thực tế'));
  for (const [, label] of columns.filter(([field]) => !['systemid', 'workorderid'].includes(field))) {
    expect(panel.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
  }
  expect(panel.getByText('29/09/2026, 08:00')).toBeVisible();
  expect(panel.getByText('25%')).toBeVisible();
  expect(panel.queryByText('Site')).not.toBeInTheDocument();
  expect(panel.queryByText('WOID')).not.toBeInTheDocument();
  expect(panel.queryByText('HT-98-MISC-SYSTEM')).not.toBeInTheDocument();
  expect(vi.mocked(getDetail).mock.calls[0][0]).toMatchObject({ site_id: 'SITE-A', workorder_id: '100' });
});
