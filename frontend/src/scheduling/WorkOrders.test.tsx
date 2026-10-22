import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getAuthSummary, getLiveness, type Session } from '../api/client';
import { columns, RetrievalError, retrieveWorkOrders, type WorkOrder } from '../api/workOrders';
import { mergePmOrigin, WorkOrders } from './WorkOrders';
import { App } from '../App';
import { deleteDraft, getDetail, lookupUploadRequest, openBatch, openDraft, prepareBatch, previewUpload, saveBatch, saveDraft, submitUpload } from '../api/drafts';
import { getConnectionSettings, saveConnectionSetting } from '../api/settings';
import { getDate, setDate, setDateTime } from '../testDateTime';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn(), getLiveness: vi.fn().mockResolvedValue(true), loginUrl: '/api/auth/login' }));
vi.mock('../api/settings', () => ({ getConnectionSettings: vi.fn(), saveConnectionSetting: vi.fn() }));
vi.mock('../api/workOrders', async (original) => ({ ...await original<object>(), retrieveWorkOrders: vi.fn() }));
vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), getDetail: vi.fn(), prepareBatch: vi.fn(),
  openDraft: vi.fn(), openBatch: vi.fn(), saveDraft: vi.fn(), saveBatch: vi.fn(), deleteDraft: vi.fn(),
  previewUpload: vi.fn(), submitUpload: vi.fn(), lookupUploadRequest: vi.fn() }));
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

it('collapses only a successfully retrieved range and opens date controls without reloading rows', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  expect(screen.getByLabelText('Target Finish từ')).toBeVisible();
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  expect(screen.getByText('Đã tải: 01/09/2026 → trước 01/10/2026')).toBeVisible();
  expect(screen.getByLabelText('Target Finish từ')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Đổi khoảng ngày' }));
  expect(screen.getByLabelText('Target Finish từ')).toBeVisible();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  setDate(screen.getByLabelText('Target Finish từ'), '2026-09-02');
  expect(screen.queryByText(/Đã tải:/)).not.toBeInTheDocument();
  vi.mocked(retrieveWorkOrders).mockRejectedValue(new Error('Retrieve failed'));
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText('Retrieve failed');
  expect(screen.getByLabelText('Target Finish từ')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Đổi khoảng ngày' })).not.toBeInTheDocument();
});

it('defaults filters to hidden and toggles beside refresh without losing filters, selection or loaded rows', async () => {
  await setup(false, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  const showFilters = screen.getByRole('button', { name: 'Hiện bộ lọc' });
  expect(showFilters).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('search')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cập nhật' }).nextElementSibling).toBe(showFilters);
  expect(screen.getByRole('heading', { name: 'Work Orders' })).not.toContainElement(showFilters);
  fireEvent.click(showFilters);
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'WO-REAL' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  const toggle = screen.getByRole('button', { name: 'Ẩn bộ lọc (1)' });
  const filterId = toggle.getAttribute('aria-controls');
  expect(screen.getByRole('search')).toHaveAttribute('id', filterId);
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Hiện bộ lọc (1)' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('search')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Hiện bộ lọc (1)' }));
  expect(screen.getByRole('button', { name: 'Ẩn bộ lọc (1)' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toBeVisible();
  expect(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name')).toHaveValue('WO-REAL');
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Bảng gọn ·/)).not.toBeInTheDocument();
});

it('keeps the first PM origin when a finalized recovery receipt carries an intermediate baseline', () => {
  const original = { worktype: 'PM', schedstart: '2026-10-01T00:00:00+07:00', schedfinish: '2026-10-02T00:00:00+07:00',
    assignedtechname: 'PIC', estdur: '25', targstartdate: '2026-09-01T00:00:00+07:00', targcompdate: null };
  const intermediate = { ...original, schedstart: '2026-10-03T00:00:00+07:00', schedfinish: '2026-10-04T00:00:00+07:00', estdur: '21' };
  const key = JSON.stringify(['user', 'one', 'MECH', 'SITE-A', '100']);
  const first = new Map([[key, original]]);
  const afterRecoveredDateRestore = mergePmOrigin(first, 'user', 'one', 'MECH',
    { site_id: 'SITE-A', workorder_id: '100', restore_source: { before: intermediate } },
    { ...original, schedstart: '2026-10-01T00:00:00Z', schedfinish: '2026-10-02T00:00:00Z', estdur: '21' });
  expect(afterRecoveredDateRestore.get(key)).toEqual(original);
  const captured = mergePmOrigin(new Map(), 'user', 'one', 'MECH',
    { site_id: 'SITE-A', workorder_id: '100', restore_source: { before: original } }, intermediate);
  expect(captured.get(key)).toEqual(original);
  const semanticallyRestored = mergePmOrigin(first, 'user', 'one', 'MECH',
    { site_id: 'SITE-A', workorder_id: '100', restore_source: null },
    { ...original, schedstart: '2026-09-30T17:00:00Z', schedfinish: '2026-10-01T17:00:00Z', estdur: '25.0' });
  expect(semanticallyRestored.has(key)).toBe(false);
  expect(mergePmOrigin(first, 'user', 'two', 'MECH',
    { site_id: 'SITE-A', workorder_id: '100', restore_source: null }, original).has(key)).toBe(true);
});

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
  expect(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration')).toHaveValue('9');
  expect(document.querySelector('[class*=draftMarker]')).toHaveTextContent(/^Nháp$/);
  expect(screen.getByRole('alert')).toHaveTextContent('Nháp đã thay đổi trong lúc tải');
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
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
  fireEvent.click(screen.getByRole('link', { name: 'Cài đặt' }));
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
  fireEvent.click(screen.getByRole('link', { name: 'Cài đặt' }));
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
  fireEvent.click(screen.getByRole('link', { name: 'Cài đặt' }));
  fireEvent.click(await screen.findByRole('radio', { name: /Onshore test/ }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByText('Lưu hệ thống'));
  expect(saveConnectionSetting).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText('Lưu hệ thống'));
  await screen.findByText(/Đã lưu hệ thống cho tài khoản/);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session });
  fireEvent.click(screen.getByRole('link', { name: '← Work Orders' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retrieve WO' })).toBeEnabled());
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
  render(<MemoryRouter initialEntries={['/work-orders']}>{withApp ? <App autoRetrieveWorkOrders={false} /> : <WorkOrders />}</MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retrieve WO' })).toBeEnabled());
  setDate(screen.getByLabelText('Target Finish từ'), '2026-09-01');
  setDate(screen.getByLabelText('Target Finish trước'), '2026-10-01');
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
  await screen.findByText('Hiển thị 2 / 2 WO. Bộ lọc chỉ áp dụng cho dữ liệu đã tải.');
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
  await screen.findByText('Hiển thị 3 / 3 WO. Bộ lọc chỉ áp dụng cho dữ liệu đã tải.');
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
  await screen.findByText('Hiển thị 1 / 1 WO. Bộ lọc chỉ áp dụng cho dữ liệu đã tải.');
  fireEvent.change(screen.getByLabelText('Tìm WO, mô tả hoặc Tag Name'), { target: { value: 'no-match' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'APPR' } });
  await chooseConnection('two');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
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
  expect(within(screen.getByLabelText('Target Finish từ')).getByLabelText('Target Finish từ (nhập)')).toHaveAttribute('placeholder', 'dd/mm/yyyy');
  expect(within(screen.getByLabelText('Target Finish trước')).getByLabelText('Target Finish trước (nhập)')).toHaveAttribute('placeholder', 'dd/mm/yyyy');
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
  setDate(screen.getByLabelText('Target Finish từ'), '2026-09-02');
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
  const homeLink = Object.assign(document.createElement('a'), { href: '/', textContent: 'Tổng quan' });
  document.body.append(homeLink);
  fireEvent.click(homeLink);
  homeLink.remove();
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  setDate(screen.getByLabelText('Target Finish từ'), '2026-09-02');
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
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
  expect(document.querySelector('[class*=draftMarker]')).toHaveTextContent(/^Nháp$/);
  expect(within(screen.getByRole('region', { name: 'WO từ Maximo' })).getByLabelText('Sửa nhanh WO-REAL Est. Duration').closest('td')).toHaveAttribute('data-draft', 'true');
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
  expect(document.querySelector('[class*=draftMarker]')).toBeNull();
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
  expect(document.querySelector('[class*=draftMarker]')).toBeNull();
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
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
  expect(document.querySelector('[class*=draftMarker]')).toBeNull();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
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
  await screen.findByText('Hiển thị 2 / 2 WO. Bộ lọc chỉ áp dụng cho dữ liệu đã tải.');
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
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Chọn nháp của WO' })).getAllByRole('button', { name: /Nháp · sửa lần cuối/ }).at(-1)!);
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('10');
  fireEvent.click(screen.getByText('Xóa nháp'));
  expect(deleteDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa nháp' }));
  await waitFor(() => expect(document.querySelector('[class*=draftMarker]')).toHaveTextContent(/^Nháp$/));
  expect(screen.queryByText('2 nháp · chọn để mở')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration')).toHaveValue('9');
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('shows current Maximo values with a review marker when a saved baseline is stale', async () => {
  await setup();
  vi.mocked(retrieveWorkOrders).mockResolvedValue([{ ...row, estdur: '8', drafts: [{ ...marker, baseline_changed: true }] }]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByText(/Nháp · Cần đối chiếu/);
  expect(screen.getByRole('cell', { name: '8' })).not.toHaveAttribute('data-draft', 'true');
  expect(screen.queryByRole('cell', { name: 'TECHNháp' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Đổi khoảng ngày' })).toBeEnabled();
});

it('reopens the same work order after explicitly discarding edits', async () => {
  await editWorkOrder();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('8');
  expect(getDetail).toHaveBeenCalledTimes(2);
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
  expect(screen.getByRole('button', { name: 'Đổi khoảng ngày' })).toBeEnabled();
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
  expect(getDate(screen.getByLabelText('Target Finish trước'))).toBe('2026-10-01');
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
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
  expect(screen.getByRole('button', { name: 'Đổi khoảng ngày' })).toBeEnabled();
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
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
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

it('refreshes and closes a finalized saved batch for the exact batch scope', async () => {
  await prepareBatchUpload();
  const latest = { ...row, estdur: '9' };
  vi.mocked(getDetail).mockResolvedValue({ ...editorDetail, item: latest });
  expect(submitUpload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Upload toàn bộ nhóm lên Offshore test'));
  await waitFor(() => expect(submitUpload).toHaveBeenCalledTimes(1));
  await screen.findByText(/Đã xác nhận 1 WO trong Maximo/);
  expect(screen.queryByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' })).not.toBeInTheDocument();
  expect(screen.getByText(/Đã xác nhận 1 WO trong Maximo/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Kiểm tra kết quả upload trước' })).not.toBeInTheDocument();
  expect(getDetail).toHaveBeenCalledWith({ connection_id: 'two', discipline: 'MECH', site_id: 'SITE-A', workorder_id: '100' }, expect.any(AbortSignal));
  expect(screen.getByRole('cell', { name: '9' })).toBeInTheDocument();
});

it('keeps the first PM origin through date restoration, offers a duration-only step, and clears it when all fields match', async () => {
  await setup(false, 'two');
  const originRow = { ...row, worktype: 'PM', schedstart: '2026-09-30T08:00:00+07:00', schedfinish: '2026-09-30T16:00:00+07:00',
    estdur: '8', targstartdate: '2026-09-01T08:00:00+07:00', targcompdate: '2026-10-01T08:00:00+07:00' };
  const original = { ...editorDetail, item: originRow, baseline: { worktype: 'PM', schedstart: originRow.schedstart, schedfinish: originRow.schedfinish,
    assignedtechname: null, estdur: '8', targstartdate: originRow.targstartdate, targcompdate: originRow.targcompdate } };
  const shiftedRow = { ...originRow, schedstart: '2026-09-30T09:00:00+07:00', schedfinish: '2026-09-30T17:00:00+07:00', estdur: '6' };
  const shifted = { ...original, item: shiftedRow, baseline: { ...original.baseline, schedstart: shiftedRow.schedstart,
    schedfinish: shiftedRow.schedfinish, estdur: '6' } };
  const datesRestoredRow = { ...originRow, estdur: '6' };
  const datesRestored = { ...original, item: datesRestoredRow, baseline: { ...original.baseline, estdur: '6' } };
  vi.mocked(retrieveWorkOrders).mockResolvedValue([originRow]);
  vi.mocked(getDetail).mockResolvedValueOnce(original).mockResolvedValueOnce(shifted).mockResolvedValueOnce(shifted)
    .mockRejectedValueOnce(new Error('temporary fresh detail failure')).mockResolvedValueOnce(datesRestored)
    .mockResolvedValueOnce(datesRestored).mockResolvedValueOnce(original).mockResolvedValueOnce(original);
  vi.mocked(saveDraft).mockResolvedValueOnce({ draft_id: 'forward', version: 1, state: 'draft' })
    .mockResolvedValueOnce({ draft_id: 'date-restore', version: 1, state: 'draft' })
    .mockResolvedValueOnce({ draft_id: 'duration-restore', version: 1, state: 'draft' });
  vi.mocked(previewUpload).mockImplementation(async (draft) => ({ draft_id: draft.draft_id, version: draft.version,
    preview_hash: 'a'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'SITE-A', workorder_id: '100', code: 'ready', warnings: [], before: {}, changes: { schedstart: '2026-09-30T09:00:00+07:00' } }] }));
  const receipt = (draftId: string, before: typeof original.baseline | null) => ({ batch_id: `batch-${draftId}`, source_finalized: true,
    counts: { confirmed: 1 }, items: [{ item_id: `item-${draftId}`, connection_id: 'two', site_id: 'SITE-A', workorder_id: '100', state: 'confirmed' as const,
      updated_at: '2026-10-08T00:00:00Z', source: { draft_id: draftId, draft_version: 1, member_id: `member-${draftId}` }, duration_result: null,
      restore_source: before ? { before } : null }] });
  vi.mocked(submitUpload).mockResolvedValueOnce(receipt('forward', original.baseline)).mockResolvedValueOnce(receipt('date-restore', shifted.baseline))
    .mockResolvedValueOnce(receipt('duration-restore', null));
  vi.mocked(lookupUploadRequest).mockResolvedValue(receipt('date-restore', shifted.baseline));
  fireEvent.click(screen.getByText('Retrieve WO'));
  fireEvent.click(await screen.findByRole('button', { name: 'WO-REAL' }));
  setDateTime(await screen.findByLabelText('Scheduled Start'), '2026-09-30T09:00');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText('Upload lên Offshore test'));
  await screen.findByText(/Đã xác nhận 1 WO trong Maximo/);

  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  await screen.findByRole('button', { name: 'Khôi phục ngày lịch gốc' });
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục ngày lịch gốc' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  expect(vi.mocked(saveDraft).mock.calls[1][1]).toEqual({ schedstart: original.baseline.schedstart, schedfinish: original.baseline.schedfinish });
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText('Upload lên Offshore test'));
  await screen.findByText(/Maximo đã xác nhận thay đổi, nhưng chưa làm mới được bảng/);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng nháp' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết quả upload trước' }));
  await screen.findByRole('heading', { name: 'Kết quả upload đã tra cứu' });

  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  const durationRestore = await screen.findByRole('button', { name: 'Khôi phục Duration gốc' });
  expect(screen.getByRole('button', { name: 'Khôi phục ngày lịch gốc' })).toBeDisabled();
  fireEvent.click(durationRestore);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  expect(vi.mocked(saveDraft).mock.calls[2][1]).toEqual({ estdur: '8' });
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText('Upload lên Offshore test'));
  await screen.findByText(/Đã xác nhận 1 WO trong Maximo/);

  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  await screen.findByLabelText('Est. Duration');
  expect(screen.queryByRole('button', { name: 'Khôi phục ngày lịch gốc' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Khôi phục Duration gốc' })).not.toBeInTheDocument();
});

it('ignores a finalized batch refresh after the connection scope changes', async () => {
  await prepareBatchUpload();
  let finish!: (value: typeof editorDetail) => void;
  vi.mocked(getDetail).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByText('Upload toàn bộ nhóm lên Offshore test'));
  await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(1));
  await chooseConnection('one');
  expect(screen.queryByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' })).not.toBeInTheDocument();
  await act(async () => finish({ ...editorDetail, item: { ...row, estdur: '9' } }));
  expect(screen.queryByText(/Đã xác nhận 1 WO trong Maximo/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Est. Duration')).not.toBeInTheDocument();
});

it('keeps an in-memory recovery entry after an ambiguous submit 404 unmounts the editor', async () => {
  await editWorkOrder();
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'recoverable-draft', version: 1, state: 'draft' });
  vi.mocked(openDraft).mockResolvedValue({ ...editorDetail, draft_id: 'recoverable-draft', version: 1, state: 'draft',
    changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await screen.findByText('Đã lưu nháp trên server. Maximo chưa thay đổi.');
  vi.mocked(previewUpload).mockResolvedValue({ draft_id: 'recoverable-draft', version: 1, preview_hash: 'c'.repeat(64),
    send_enabled: true, gate: null, items: [{ site_id: 'SITE-A', workorder_id: '100', code: 'ready', warnings: [], before: { estdur: '8' }, changes: { estdur: '9' } }] });
  vi.mocked(submitUpload).mockRejectedValue(new RetrievalError(404, 'Scoped read failed after send'));
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000002');
  fireEvent.click(screen.getByText('Đối chiếu với Maximo trước upload'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
  fireEvent.click(screen.getByText('Upload lên Offshore test'));
  await screen.findByRole('button', { name: 'Kiểm tra kết quả upload trước' });
  expect(screen.queryByLabelText('Est. Duration')).not.toBeInTheDocument();
  vi.mocked(lookupUploadRequest).mockResolvedValue({ batch_id: 'batch', source_finalized: false, counts: { sending: 1 },
    items: [{ item_id: 'item', connection_id: 'two', site_id: 'SITE-A', workorder_id: '100', state: 'sending',
      updated_at: '2026-10-08T00:00:00Z', source: { draft_id: 'recoverable-draft', draft_version: 1, member_id: 'source-item' }, duration_result: null, restore_source: null }] });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết quả upload trước' }));
  await screen.findByText('Kết quả upload đã tra cứu');
  expect(lookupUploadRequest).toHaveBeenCalledWith(expect.objectContaining({ request_id: '00000000-0000-4000-8000-000000000002',
    connection_id: 'two', discipline: 'MECH', draft_id: 'recoverable-draft', version: 1 }), expect.any(AbortSignal));
  expect(screen.getByText(/Đang gửi: 1/)).toBeInTheDocument();
});

async function prepareBatchUpload() {
  const second = { ...row, workorderid: '101', wonum: 'WO-SECOND' };
  await setup(false, 'two');
  const sent = { draft_id: 'batch-draft', version: 1, state: 'draft' as const };
  const drafted = { ...row, drafts: [{ ...marker, draft_id: 'batch-draft', changes: { estdur: '9' } }] };
  vi.mocked(retrieveWorkOrders).mockResolvedValue([drafted, second]);
  vi.mocked(openBatch).mockResolvedValue({ ...sent, items: [{ ...editorDetail, changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true }] });
  const preview = { draft_id: 'batch-draft', version: 1, preview_hash: 'a'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'SITE-A', workorder_id: '100', code: 'ready' as const, warnings: [], before: { estdur: '8' }, changes: { estdur: '9' } }] };
  vi.mocked(previewUpload).mockResolvedValue(preview);
  vi.mocked(submitUpload).mockResolvedValue({ batch_id: 'batch-id', source_finalized: true, counts: { confirmed: 1 },
    items: [{ item_id: 'upload-item', connection_id: 'two', site_id: 'SITE-A', workorder_id: '100', state: 'confirmed',
      updated_at: '2026-10-08T00:00:00Z', source: { draft_id: 'batch-draft', draft_version: 1, member_id: 'draft-item' }, duration_result: null, restore_source: null }] });
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-SECOND' });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi 1 WO lên Maximo' }));
  await screen.findByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' });
  fireEvent.click(await screen.findByText('Đối chiếu nhóm với Maximo trước upload'));
  await screen.findByText('Maximo chưa thay đổi. Hãy kiểm tra lại các thay đổi trước khi gửi.');
}

it('shows the bulk bar only for selected rows and remembers the table density', async () => {
  localStorage.removeItem('workorder-scheduler-density');
  await setup(true, 'two');
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: 'WO-REAL' });
  expect(screen.queryByRole('region', { name: 'Thao tác với WO đã chọn' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn WO-REAL · dòng 1' }));
  const bar = screen.getByRole('region', { name: 'Thao tác với WO đã chọn' });
  expect(bar).toHaveTextContent('1 WO đã chọn');
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
  expect(screen.queryByRole('region', { name: 'Thao tác với WO đã chọn' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bảng gọn' }));
  expect(screen.getByRole('button', { name: 'Bảng thoáng' })).toHaveAttribute('aria-pressed', 'true');
  expect(localStorage.getItem('workorder-scheduler-density')).toBe('dense');
  localStorage.removeItem('workorder-scheduler-density');
});

it('prefills the current month and retrieves it once without a click', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-16T05:00:00Z'));
  vi.mocked(getLiveness).mockResolvedValue(true);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, preferred_connection_id: 'two' } });
  vi.mocked(retrieveWorkOrders).mockResolvedValue([row]);
  render(<MemoryRouter initialEntries={['/work-orders']}><WorkOrders autoRetrieve /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'WO-REAL' })).toBeInTheDocument();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(vi.mocked(retrieveWorkOrders).mock.calls[0][0]).toMatchObject({ connection_id: 'two', discipline: 'MECH',
    target_from: '2026-10-01T00:00:00+07:00', target_before: '2026-11-01T00:00:00+07:00' });
  fireEvent.click(screen.getByText('Đổi khoảng ngày'));
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-10-01');
  expect(getDate(screen.getByLabelText('Target Finish trước'))).toBe('2026-11-01');
});

it('does not retry automatically after a failed first load', async () => {
  vi.mocked(getLiveness).mockResolvedValue(true);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, preferred_connection_id: 'two' } });
  vi.mocked(retrieveWorkOrders).mockRejectedValue(new Error('Maximo chưa phản hồi'));
  render(<MemoryRouter initialEntries={['/work-orders']}><WorkOrders autoRetrieve /></MemoryRouter>);
  expect(await screen.findByText('Maximo chưa phản hồi')).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Retrieve WO' })).toBeEnabled();
});

const picDetail = { item: row, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'],
  baseline: { worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: null, estdur: '8', targstartdate: null, targcompdate: row.targcompdate } };
const suggestion = { id: 1, connection_id: 'two', discipline: 'MECH', site_id: 'SITE-A', workorder_id: '100', pic: 'TECH' };

it('opens the suggested WO with the PIC pre-filled and unsaved, and reports the suggestion as handled', async () => {
  vi.mocked(getLiveness).mockResolvedValue(true);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, preferred_connection_id: 'two' } });
  vi.mocked(getDetail).mockResolvedValue(picDetail);
  const handled = vi.fn();
  render(<MemoryRouter initialEntries={['/work-orders']}><WorkOrders picSuggestion={suggestion} onPicSuggestionHandled={handled} /></MemoryRouter>);
  expect(await screen.findByText(/Đã điền sẵn PIC TECH \(chưa lưu\)/)).toBeInTheDocument();
  expect(screen.getByLabelText('Assigned PIC')).toHaveValue('TECH');
  expect(handled).toHaveBeenCalledTimes(1);
  expect(saveDraft).not.toHaveBeenCalled();
});

it('refuses a PIC suggestion made for another connection or discipline', async () => {
  vi.mocked(getLiveness).mockResolvedValue(true);
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: { ...session, preferred_connection_id: 'two' } });
  const handled = vi.fn();
  render(<MemoryRouter initialEntries={['/work-orders']}><WorkOrders picSuggestion={{ ...suggestion, connection_id: 'one' }} onPicSuggestionHandled={handled} /></MemoryRouter>);
  expect(await screen.findByText(/thuộc kết nối hoặc discipline khác/)).toBeInTheDocument();
  expect(getDetail).not.toHaveBeenCalled();
  expect(handled).toHaveBeenCalledTimes(1);
});

// Inline cell editing: Scheduled Start, Assigned PIC and Duration are typed straight into the table and saved as drafts.
async function inlineSetup(rows: WorkOrder[]) {
  vi.mocked(retrieveWorkOrders).mockResolvedValue(rows);
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  await setup(false, 'two');
  fireEvent.click(screen.getByText('Retrieve WO'));
  const region = await screen.findByRole('region', { name: 'WO từ Maximo' });
  fireEvent.mouseEnter(region);
  await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(1));
  return region;
}
const orderWith = (overrides: Partial<WorkOrder>) => ({ ...row, estdur: '8', ...overrides }) as WorkOrder;

it('stages Duration and PIC typed in the row and saves them as one new draft without touching Maximo', async () => {
  await inlineSetup([orderWith({})]);
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration'), { target: { value: '12' } });
  await waitFor(() => expect(within(screen.getByLabelText('Sửa nhanh WO-REAL Assigned PIC')).getByRole('option', { name: 'TECH' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Assigned PIC'), { target: { value: 'TECH' } });
  expect(screen.getByText('1 WO có thay đổi chưa lưu')).toBeInTheDocument();
  vi.mocked(prepareBatch).mockResolvedValue([{ ...editorDetail, item: orderWith({}) }]);
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'new', version: 1, state: 'draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu 1 nháp' }));
  await screen.findByText('Đã lưu nháp cho 1 WO. Maximo chưa thay đổi.');
  const call = vi.mocked(saveDraft).mock.calls[0];
  expect(call[1]).toEqual({ estdur: '12', assignedtechname: 'TECH' });
  expect(call[4]).toBeNull();
  expect(screen.queryByText('1 WO có thay đổi chưa lưu')).not.toBeInTheDocument();
});

it('recomputes Scheduled Finish on the offshore shift as soon as a start is typed and flags a start past Target Finish', async () => {
  await inlineSetup([orderWith({ targcompdate: '2026-12-31T23:00:00+07:00' }), orderWith({ workorderid: '101', wonum: 'WO-LATE' })]);
  setDateTime(screen.getByLabelText('Sửa nhanh WO-REAL Scheduled Start'), '2026-10-05T06:30');
  const cell = screen.getByLabelText('Sửa nhanh WO-REAL Scheduled Start (chưa lưu)').closest('td')!;
  expect(cell).toHaveTextContent('05/10/2026, 14:30');
  expect(cell).toHaveTextContent('Nháp');
  setDateTime(screen.getByLabelText('Sửa nhanh WO-LATE Scheduled Start'), '2026-10-05T06:30');
  const late = screen.getByLabelText('Sửa nhanh WO-LATE Scheduled Start (chưa lưu)').closest('td')!;
  expect(within(late).getByRole('alert')).toHaveTextContent('Target Finish');
  expect(screen.getByRole('button', { name: 'Lưu 2 nháp' })).toBeDisabled();
});

it('updates the existing draft of a row instead of creating another one', async () => {
  await inlineSetup([orderWith({ drafts: [marker] })]);
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration'), { target: { value: '12' } });
  vi.mocked(prepareBatch).mockResolvedValue([{ ...editorDetail, item: orderWith({}) }]);
  vi.mocked(saveDraft).mockResolvedValue({ draft_id: 'draft-one', version: 2, state: 'draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu 1 nháp' }));
  await screen.findByText('Đã lưu nháp cho 1 WO. Maximo chưa thay đổi.');
  const call = vi.mocked(saveDraft).mock.calls[0];
  expect(call[1]).toEqual({ estdur: '12', assignedtechname: 'TECH' });
  expect(call[4]).toMatchObject({ draft_id: 'draft-one', version: 1 });
});

it('fills a typed value down to the other ticked rows with Ctrl+D', async () => {
  const second = orderWith({ workorderid: '101', wonum: 'WO-TWO' });
  await inlineSetup([orderWith({}), second]);
  fireEvent.click(screen.getByLabelText(/Chọn WO-REAL/)); fireEvent.click(screen.getByLabelText(/Chọn WO-TWO/));
  const first = screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration');
  fireEvent.change(first, { target: { value: '10' } });
  fireEvent.keyDown(first, { key: 'd', ctrlKey: true });
  expect(screen.getByLabelText('Sửa nhanh WO-TWO Est. Duration (chưa lưu)')).toHaveValue('10');
  expect(screen.getByText('2 WO có thay đổi chưa lưu')).toBeInTheDocument();
});

it('saves several new rows as separate drafts, never as a group, and a failing row does not block the others', async () => {
  const two = orderWith({ workorderid: '101', wonum: 'WO-TWO' });
  await inlineSetup([orderWith({}), two]);
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-TWO Est. Duration'), { target: { value: '11' } });
  vi.mocked(prepareBatch).mockResolvedValue([{ ...editorDetail, item: orderWith({}) }, { ...editorDetail, item: two }]);
  vi.mocked(saveDraft).mockResolvedValueOnce({ draft_id: 'a', version: 1, state: 'draft' }).mockRejectedValueOnce(new Error('Máy chủ lỗi'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu 2 nháp' }));
  await screen.findByText('Đã lưu nháp cho 1 WO. Maximo chưa thay đổi.');
  expect(saveDraft).toHaveBeenCalledTimes(2);
  expect(saveBatch).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Sửa nhanh WO-TWO Est. Duration (chưa lưu)')).toHaveValue('11');
  expect(screen.getByText('1 WO có thay đổi chưa lưu')).toBeInTheDocument();
});

it('moves between rows of the same column with Enter and the arrow keys, but leaves drop-down arrows alone', async () => {
  await inlineSetup([orderWith({}), orderWith({ workorderid: '101', wonum: 'WO-TWO' }), orderWith({ workorderid: '102', wonum: 'WO-THREE' })]);
  const duration = (wo: string) => screen.getByLabelText(new RegExp(`Sửa nhanh ${wo} Est. Duration`));
  duration('WO-REAL').focus();
  fireEvent.keyDown(duration('WO-REAL'), { key: 'Enter' });
  expect(duration('WO-TWO')).toHaveFocus();
  fireEvent.keyDown(duration('WO-TWO'), { key: 'ArrowDown' });
  expect(duration('WO-THREE')).toHaveFocus();
  fireEvent.keyDown(duration('WO-THREE'), { key: 'ArrowUp' });
  expect(duration('WO-TWO')).toHaveFocus();
  fireEvent.keyDown(duration('WO-TWO'), { key: 'Enter', shiftKey: true });
  expect(duration('WO-REAL')).toHaveFocus();
  // The first row has nowhere to go up to, so focus stays.
  fireEvent.keyDown(duration('WO-REAL'), { key: 'ArrowUp' });
  expect(duration('WO-REAL')).toHaveFocus();
  const pic = (wo: string) => screen.getByLabelText(new RegExp(`Sửa nhanh ${wo} Assigned PIC`));
  pic('WO-REAL').focus();
  fireEvent.keyDown(pic('WO-REAL'), { key: 'ArrowDown' });
  expect(pic('WO-REAL')).toHaveFocus();
  fireEvent.keyDown(pic('WO-REAL'), { key: 'Enter' });
  expect(pic('WO-TWO')).toHaveFocus();
});

it('fills a chosen PIC down to the ticked rows with Ctrl+D', async () => {
  const two = orderWith({ workorderid: '101', wonum: 'WO-TWO' });
  await inlineSetup([orderWith({}), two]);
  await waitFor(() => expect(within(screen.getByLabelText('Sửa nhanh WO-REAL Assigned PIC')).getByRole('option', { name: 'TECH' })).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText(/Chọn WO-REAL/)); fireEvent.click(screen.getByLabelText(/Chọn WO-TWO/));
  const first = screen.getByLabelText('Sửa nhanh WO-REAL Assigned PIC');
  fireEvent.change(first, { target: { value: 'TECH' } });
  fireEvent.keyDown(first, { key: 'd', code: 'KeyD', ctrlKey: true });
  expect(screen.getByLabelText('Sửa nhanh WO-TWO Assigned PIC (chưa lưu)')).toHaveValue('TECH');
});

it('blocks saving while a typed value is invalid and lets the user discard the edits', async () => {
  await inlineSetup([orderWith({})]);
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration'), { target: { value: 'abc' } });
  expect(screen.getByRole('button', { name: 'Lưu 1 nháp' })).toBeDisabled();
  expect(screen.getAllByRole('alert').some((node) => /Duration phải là số/.test(node.textContent ?? ''))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hủy thay đổi' }));
  expect(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration')).toHaveValue('8');
  expect(saveDraft).not.toHaveBeenCalled();
});

// Date-range change with drafts: the drafts live on the server, so the user must agree before they are deleted.
const second = { ...row, workorderid: '101', wonum: 'WO-SECOND' };
const otherMarker = { ...marker, draft_id: 'draft-two', version: 4, changes: { estdur: '10' } };
async function loadDrafted(rows: WorkOrder[], connection = 'two') {
  await setup(false, connection);
  vi.mocked(retrieveWorkOrders).mockResolvedValue(rows);
  fireEvent.click(screen.getByText('Retrieve WO'));
  await screen.findByRole('button', { name: rows[0].wonum });
}

it('keeps the range and the open editor when unsaved edits are not discarded', async () => {
  await editWorkOrder();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Đổi khoảng ngày' }));
  expect(screen.getByRole('button', { name: 'Đổi khoảng ngày' })).toBeVisible();
  expect(screen.getByLabelText('Est. Duration')).toHaveValue('9');
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
});

it('warns that drafts are lost before the date fields open and keeps everything when cancelled', async () => {
  await loadDrafted([{ ...row, drafts: [marker] }, { ...second, drafts: [otherMarker] }, { ...row, workorderid: '102', wonum: 'WO-PLAIN' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Đổi khoảng ngày' }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('mất nháp');
  expect(dialog).toHaveTextContent('nháp của 2 WO chưa upload');
  expect(screen.getByLabelText('Target Finish từ').closest('form')).not.toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Xóa nháp và đổi ngày' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ thay đổi, giữ nháp' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Target Finish từ').closest('form')).not.toBeVisible();
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
  expect(screen.getByRole('button', { name: 'WO-PLAIN' })).toBeVisible();
  expect(document.querySelectorAll('[class*=draftMarker]')).toHaveLength(2);
  expect(deleteDraft).not.toHaveBeenCalled();
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
});

it('deletes each distinct draft once, in order, then opens the date fields without another warning', async () => {
  await loadDrafted([{ ...row, drafts: [{ ...marker, is_batch: true }] }, { ...second, drafts: [{ ...marker, is_batch: true }, otherMarker] }]);
  vi.mocked(deleteDraft).mockResolvedValue();
  fireEvent.click(screen.getByRole('button', { name: 'Đổi khoảng ngày' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('nháp của 2 WO chưa upload');
  fireEvent.click(screen.getByRole('button', { name: 'Xóa nháp và đổi ngày' }));
  await waitFor(() => expect(screen.getByLabelText('Target Finish từ').closest('form')).toBeVisible());
  expect(vi.mocked(deleteDraft).mock.calls.map(([draft]) => draft)).toEqual([
    { draft_id: 'draft-one', version: 1, state: 'draft' }, { draft_id: 'draft-two', version: 4, state: 'draft' }]);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  setDate(screen.getByLabelText('Target Finish từ'), '2026-08-01');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  await screen.findByText(/Chưa Retrieve WO cho khoảng ngày này/);
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-08-01');
});

it('lets the user back out of an opened date range without losing the table', async () => {
  await loadDrafted([{ ...row }]);
  fireEvent.click(screen.getByRole('button', { name: 'Đổi khoảng ngày' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
  expect(screen.getByRole('button', { name: 'Đổi khoảng ngày' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
});

it('keeps the dialog open and the range unchanged when a draft cannot be deleted', async () => {
  await loadDrafted([{ ...row, drafts: [marker] }, { ...second, drafts: [otherMarker] }]);
  vi.mocked(deleteDraft).mockResolvedValueOnce().mockRejectedValueOnce(new RetrievalError(500, 'Máy chủ lỗi'));
  fireEvent.click(screen.getByRole('button', { name: 'Đổi khoảng ngày' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xóa nháp và đổi ngày' }));
  const dialog = await screen.findByRole('alertdialog');
  await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Máy chủ lỗi'));
  // Only the draft that is still there is counted.
  expect(dialog).toHaveTextContent('nháp của 1 WO chưa upload');
  expect(getDate(screen.getByLabelText('Target Finish từ'))).toBe('2026-09-01');
  expect(screen.getByRole('button', { name: 'WO-REAL' })).toBeVisible();
});

// Send bar: every draft of the loaded WOs goes to Maximo as one reviewed group.
const groupMarker = { ...marker, draft_id: 'group', version: 3, is_batch: true, changes: { estdur: '9' } };
const member = (item: WorkOrder) => ({ ...editorDetail, item, changes: { estdur: '9' }, baseline_changed: false, changes_valid_now: true });

it('offers the send bar only to writers who have drafts and counts WOs, not drafts', async () => {
  await loadDrafted([{ ...row, drafts: [groupMarker] }, { ...second, drafts: [groupMarker] }, { ...row, workorderid: '102', wonum: 'WO-PLAIN' }], 'one');
  expect(screen.queryByRole('region', { name: 'Gửi WO có nháp lên Maximo' })).not.toBeInTheDocument();
  cleanup();
  vi.resetAllMocks();
  await loadDrafted([{ ...row, drafts: [groupMarker] }, { ...second, drafts: [groupMarker] }, { ...row, workorderid: '102', wonum: 'WO-PLAIN' }]);
  const bar = screen.getByRole('region', { name: 'Gửi WO có nháp lên Maximo' });
  expect(bar).toHaveTextContent('2 WO có nháp chưa gửi');
  expect(within(bar).getByRole('button', { name: 'Gửi 2 WO lên Maximo' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Lập lịch nhóm/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nháp của tôi' })).not.toBeInTheDocument();
});

it('disables sending while table edits are unsaved', async () => {
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  await loadDrafted([orderWith({ drafts: [groupMarker] })]);
  const button = screen.getByRole('button', { name: 'Gửi 1 WO lên Maximo' });
  expect(button).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration'), { target: { value: '12' } });
  expect(button).toBeDisabled();
  expect(screen.getByText('Lưu các thay đổi trong bảng trước khi gửi')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Hủy thay đổi' }));
  expect(button).toBeEnabled();
});

it('hands unsaved cell edits to the detail dialog and keeps them in the table until a draft is saved', async () => {
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  await inlineSetup([orderWith({})]);
  fireEvent.change(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('7');
  expect(screen.getByLabelText('Sửa nhanh WO-REAL Est. Duration (chưa lưu)')).toHaveValue('7');
});

it('opens a member of a group draft in the detail dialog with the group draft values', async () => {
  vi.mocked(getDetail).mockResolvedValue(editorDetail);
  await loadDrafted([orderWith({ drafts: [groupMarker] })]);
  fireEvent.click(screen.getByRole('button', { name: 'WO-REAL' }));
  expect(await screen.findByLabelText('Est. Duration')).toHaveValue('9');
});

it('opens the existing group draft untouched in the send-only panel', async () => {
  await loadDrafted([{ ...row, drafts: [groupMarker] }, { ...second, drafts: [groupMarker] }]);
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'group', version: 3, state: 'draft', items: [member(row), member(second)] });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi 2 WO lên Maximo' }));
  const panel = await screen.findByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' });
  await within(panel).findByText('Đối chiếu nhóm với Maximo trước upload');
  expect(within(panel).getByRole('heading', { name: 'Gửi 2 WO lên Maximo' })).toBeVisible();
  expect(within(panel).getByRole('table', { name: 'Các WO sẽ gửi' })).toBeVisible();
  expect(within(panel).queryByText('Áp dụng vào nháp')).not.toBeInTheDocument();
  expect(within(panel).queryByText('Xóa nháp nhóm')).not.toBeInTheDocument();
  expect(saveBatch).not.toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
  expect(prepareBatch).not.toHaveBeenCalled();
});

it('keeps the send panel across a tab return and releases the scroll lock on close', async () => {
  await loadDrafted([{ ...row, drafts: [groupMarker] }]);
  vi.mocked(openBatch).mockResolvedValue({ draft_id: 'group', version: 3, state: 'draft', items: [member(row)] });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi 1 WO lên Maximo' }));
  await screen.findByText('Đối chiếu nhóm với Maximo trước upload');
  expect(document.documentElement).toHaveAttribute('data-wo-panel-open');
  const reads = vi.mocked(openBatch).mock.calls.length;
  await act(async () => returnToPage());
  expect(screen.getByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' })).toBeVisible();
  expect(vi.mocked(openBatch).mock.calls.length).toBe(reads);
  expect(retrieveWorkOrders).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng nhóm' }));
  expect(document.documentElement).not.toHaveAttribute('data-wo-panel-open');
});

it('merges several drafts into one new group, deleting the old ones only after it is saved', async () => {
  await loadDrafted([orderWith({ drafts: [marker] }), orderWith({ workorderid: '101', wonum: 'WO-SECOND', drafts: [otherMarker] })]);
  const merged = { draft_id: 'merged', version: 1, state: 'draft' as const };
  vi.mocked(prepareBatch).mockResolvedValue([{ ...editorDetail, item: row }, { ...editorDetail, item: second }]);
  vi.mocked(saveBatch).mockResolvedValue(merged);
  vi.mocked(deleteDraft).mockResolvedValue();
  vi.mocked(openBatch).mockResolvedValue({ ...merged, items: [member(row), member(second)] });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi 2 WO lên Maximo' }));
  await screen.findByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' });
  expect(saveBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveBatch).mock.calls[0][1]).toHaveLength(2);
  expect(vi.mocked(saveBatch).mock.calls[0][3]).toBeNull();
  expect(deleteDraft).toHaveBeenCalledTimes(2);
  const saveOrder = vi.mocked(saveBatch).mock.invocationCallOrder[0];
  vi.mocked(deleteDraft).mock.invocationCallOrder.forEach((order) => expect(order).toBeGreaterThan(saveOrder));
  expect(openBatch).toHaveBeenCalledWith('merged', expect.anything(), expect.any(AbortSignal));
});

it('reports WOs dropped from the merged group and old drafts that could not be deleted', async () => {
  await loadDrafted([orderWith({ drafts: [{ ...marker, changes: { estdur: '8' } }] }), orderWith({ workorderid: '101', wonum: 'WO-SECOND', drafts: [otherMarker] })]);
  const merged = { draft_id: 'merged', version: 1, state: 'draft' as const };
  vi.mocked(prepareBatch).mockResolvedValue([{ ...editorDetail, item: row }, { ...editorDetail, item: second }]);
  vi.mocked(saveBatch).mockResolvedValue(merged);
  vi.mocked(deleteDraft).mockRejectedValueOnce(new RetrievalError(500, 'Máy chủ lỗi')).mockResolvedValue();
  vi.mocked(openBatch).mockResolvedValue({ ...merged, items: [member(second)] });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi 2 WO lên Maximo' }));
  const panel = await screen.findByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' });
  expect(within(panel).getByText(/Bỏ khỏi nhóm WO-REAL/)).toBeVisible();
  expect(within(panel).getByText(/Chưa xóa được một nháp cũ/)).toBeVisible();
  expect(vi.mocked(saveBatch).mock.calls[0][1]).toHaveLength(1);
  expect(deleteDraft).toHaveBeenCalledTimes(2);
});

it('stays on the table with a clear message when more than 200 WOs would be sent', async () => {
  const many = Array.from({ length: 201 }, (_, i) => orderWith({ workorderid: String(100 + i), wonum: `WO-${i}`, drafts: [{ ...marker, draft_id: `d${i}` }] }));
  await loadDrafted(many);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi 201 WO lên Maximo' }));
  expect(await screen.findByText(/giới hạn 200 WO/)).toBeVisible();
  expect(saveBatch).not.toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Gửi nhóm WO lên Maximo' })).not.toBeInTheDocument();
});
