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
  { connection_id: 'one', label: 'Onshore test', system: 'onshore', environment: 'test', discipline: 'MECH', capability: 'read' },
  { connection_id: 'two', label: 'Offshore test', system: 'offshore', environment: 'test', discipline: 'MECH', capability: 'write' },
] };
const row = { ...Object.fromEntries(columns.map(([field]) => [field, null])),
  siteid: 'SITE-A', wonum: 'WO-REAL', workorderid: '100', bdpocdiscipline: 'MECH',
  status: 'APPR', worktype: 'CM', targcompdate: '2026-09-30T23:00:00+07:00', wopriority: 0,
} as WorkOrder;
const editorDetail = { item: row, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'],
  baseline: { worktype: 'CM', schedstart: null, schedfinish: null, assignedtechname: null, estdur: '8',
    targstartdate: null, targcompdate: row.targcompdate } };

async function setup() {
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session });
  render(<MemoryRouter><WorkOrders /></MemoryRouter>);
  const select = await screen.findByLabelText('Hệ thống / Discipline');
  fireEvent.change(select, { target: { value: JSON.stringify(['one', 'MECH']) } });
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-01T00:00:00+07:00' } });
  fireEvent.change(screen.getByLabelText('Target Finish trước'), { target: { value: '2026-10-01T00:00:00+07:00' } });
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
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-02T00:00:00+07:00' } });
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
  fireEvent.change(screen.getByLabelText('Target Finish từ'), { target: { value: '2026-09-02T00:00:00+07:00' } });
  expect(screen.getByLabelText('Target Finish từ')).toHaveValue('2026-09-01T00:00:00+07:00');
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
