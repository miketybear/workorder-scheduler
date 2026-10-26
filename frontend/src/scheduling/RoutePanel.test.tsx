import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRouteSession, deleteRouteSession, getRouteSubmission, previewRoute, reconcileRoute, RouteApiError, routeWorkOrders,
  type PreviewItem, type RouteResult, type RouteStatus } from '../api/workflowRoute';
import { columns, type WorkOrder } from '../api/workOrders';
import { RoutePanel } from './RoutePanel';

vi.mock('../api/workflowRoute', async (original) => ({ ...await original<object>(), createRouteSession: vi.fn(), previewRoute: vi.fn(),
  routeWorkOrders: vi.fn(), getRouteSubmission: vi.fn(), reconcileRoute: vi.fn(), deleteRouteSession: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const scope = { connection_id: 'conn', discipline: 'E&I' };
const order = (wonum: string, id: string) => ({ ...Object.fromEntries(columns.map(([field]) => [field, null])),
  siteid: 'BD1', wonum, workorderid: id, worktype: 'CM', status: 'SCHED', targcompdate: '2026-10-31T00:00:00+07:00', wopriority: 0 }) as WorkOrder;
const rows = [order('P1', '1'), order('P2', '2')];
const status = (active: boolean): RouteStatus => ({ enabled: true, can_route: true, personid: 'ENISUP', session: { active, expires_at: null } });
const ready = (id: string, wonum: string, extra: Partial<PreviewItem> = {}): PreviewItem => ({ site_id: 'BD1', workorder_id: id, wonum, ready: true,
  code: 'ready', node_id: 40, wfassignment_id: '9', assigned_to: 'VIETLV', supervisor: { current: null, will_set: 'NHATNH' }, ...extra });
const result = (states: [string, string, string | null][]): RouteResult => ({ request_id: 'r', complete: true, counts: {},
  items: states.map(([id, state, code]) => ({ site_id: 'BD1', workorder_id: id, wonum: `P${id}`, state: state as RouteResult['items'][number]['state'], code,
    wfassignment_id_after: null, assigned_to: 'VIETLV' })) });

function open(session: boolean, onResult = vi.fn(), onSession = vi.fn(), onClose = vi.fn(), onDenied = vi.fn()) {
  render(<RoutePanel scope={scope} status={status(session)} rows={rows} onSession={onSession} onResult={onResult} onClose={onClose} onDenied={onDenied} />);
  return { onResult, onSession, onClose, onDenied };
}

it('asks for the position account password once, never keeps it, then routes after a confirmation', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1'), { ...ready('2', 'P2'), ready: false, code: 'missing_schedule' }] });
  vi.mocked(createRouteSession).mockResolvedValue({ active: true, expires_at: '2026-10-23T18:00:00+00:00' });
  vi.mocked(routeWorkOrders).mockResolvedValue(result([['1', 'confirmed', null]]));
  const { onResult, onSession } = open(false);
  const field = await screen.findByLabelText('Mật khẩu') as HTMLInputElement;
  expect(screen.getByLabelText('Tài khoản')).toHaveValue('ENISUP');
  expect(screen.getByText(/Sẽ route 1 WO:/)).toHaveTextContent('P1');
  expect(screen.getByText(/P2: Thiếu lịch/)).toBeInTheDocument();
  fireEvent.change(field, { target: { value: 'secret-pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  await screen.findByRole('button', { name: 'Route 1 WO' });
  expect(vi.mocked(createRouteSession).mock.calls[0].slice(0, 3)).toEqual([scope, 'ENISUP', 'secret-pw']);
  expect(onSession).toHaveBeenCalledWith({ active: true, expires_at: '2026-10-23T18:00:00+00:00' });
  expect(document.body.innerHTML).not.toContain('secret-pw');
  expect(screen.getByText('Sẽ điền NHATNH')).toBeInTheDocument();
  expect(routeWorkOrders).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Route 1 WO' }));
  await screen.findByText('Đã route 1 WO.');
  const call = vi.mocked(routeWorkOrders).mock.calls[0];
  expect(call[2]).toEqual([{ site_id: 'BD1', workorder_id: '1' }]);
  expect(call[1]).toMatch(/^[0-9a-f-]{36}$/);
  expect(onResult).toHaveBeenCalledOnce();
});

it('goes straight to the confirmation when the server already holds the session', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1'), ready('2', 'P2', { supervisor: { current: 'VINHDN', will_set: null } })] });
  open(true);
  await screen.findByRole('button', { name: 'Route 2 WO' });
  expect(screen.queryByLabelText('Mật khẩu')).not.toBeInTheDocument();
  expect(screen.getByText('VINHDN')).toBeInTheDocument();
});

it('reports a wrong password with the attempts left and clears the field', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1')] });
  vi.mocked(createRouteSession).mockRejectedValue(new RouteApiError(422, 'maximo_login_failed', 'x', { remaining_attempts: 2 }));
  open(false);
  const field = await screen.findByLabelText('Mật khẩu') as HTMLInputElement;
  fireEvent.change(field, { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  await screen.findByText(/Sai mật khẩu của ENISUP\. Còn 2 lần thử/);
  expect(field.value).toBe('');
  expect(document.body.innerHTML).not.toContain('wrong');
});

it('goes back to the password form when the server lost the session', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1')] });
  vi.mocked(routeWorkOrders).mockRejectedValue(new RouteApiError(409, 'route_session_required', 'x'));
  const { onSession } = open(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Route 1 WO' }));
  await screen.findByLabelText('Mật khẩu');
  expect(onSession).toHaveBeenCalledWith({ active: false, expires_at: null });
});

it('never claims success while a WO is stranded or unknown and offers a read-only recheck', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1'), ready('2', 'P2'), ready('3', 'P3')] });
  vi.mocked(routeWorkOrders).mockResolvedValue(result([['1', 'confirmed', null], ['2', 'stranded', 'stranded_no_assignment'], ['3', 'unknown', 'choose_unconfirmed']]));
  vi.mocked(reconcileRoute).mockResolvedValue(result([['1', 'confirmed', null], ['2', 'stranded', 'stranded_no_assignment'], ['3', 'confirmed', null]]));
  open(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Route 3 WO' }));
  await screen.findByText(/Có 2\/3 WO chưa route xong/);
  expect(screen.queryByText(/Đã route 3 WO/)).not.toBeInTheDocument();
  const alert = screen.getAllByRole('alert').map((node) => node.textContent).join(' ');
  expect(alert).toMatch(/mất việc cần admin Maximo/);
  expect(alert).toMatch(/không route lại/);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra lại' }));
  await waitFor(() => expect(reconcileRoute).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Kiểm tra lại' })).not.toBeInTheDocument());
  expect(within(screen.getByRole('table', { name: 'Kết quả route' })).getAllByText('Đã route')).toHaveLength(2);
});

it('after a lost connection it only reads the stored result and never routes again', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1')] });
  vi.mocked(routeWorkOrders).mockRejectedValue(new TypeError('network'));
  vi.mocked(getRouteSubmission).mockResolvedValue(result([['1', 'confirmed', null]]));
  open(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Route 1 WO' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra lại' }));
  await screen.findByText('Đã route 1 WO.');
  expect(routeWorkOrders).toHaveBeenCalledOnce();
  expect(getRouteSubmission).toHaveBeenCalledWith(expect.any(String), expect.anything());
});

it('locks when the workflow definition changed and when nothing is ready', async () => {
  vi.mocked(previewRoute).mockResolvedValueOnce({ contract: { ok: false, problem: 'node_34_condition_present' }, items: [{ ...ready('1', 'P1'), ready: false, code: 'contract_changed' }] });
  open(true);
  await screen.findByText(/đang bị khóa/);
  expect(screen.queryByRole('button', { name: /^Route \d/ })).not.toBeInTheDocument();
  cleanup();
  vi.mocked(previewRoute).mockResolvedValueOnce({ contract: { ok: true, problem: null }, items: [{ ...ready('1', 'P1'), ready: false, code: 'not_synced' }] });
  open(true);
  await screen.findByText('Không có WO nào đủ điều kiện route lúc này.');
  expect(screen.getByText(/P1: Còn nháp chưa gửi/)).toBeInTheDocument();
});

it('lets the user forget the held position-account session from the confirmation and asks again', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1')] });
  vi.mocked(deleteRouteSession).mockResolvedValue();
  const { onSession } = open(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Quên phiên tài khoản route' }));
  await screen.findByLabelText('Mật khẩu');
  expect(deleteRouteSession).toHaveBeenCalledWith(scope, expect.anything());
  expect(onSession).toHaveBeenCalledWith({ active: false, expires_at: null });
  expect(routeWorkOrders).not.toHaveBeenCalled();
});

it('only explains the values it will write when there are any', async () => {
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1', { supervisor: { current: 'TRUNGNT', will_set: null } })] });
  open(true);
  await screen.findByRole('button', { name: 'Route 1 WO' });
  expect(screen.queryByText(/được ghi vào WO trên Maximo trước khi route/)).not.toBeInTheDocument();
  cleanup();
  vi.mocked(previewRoute).mockResolvedValue({ contract: { ok: true, problem: null }, items: [ready('1', 'P1')] });
  open(true);
  await screen.findByText(/được ghi vào WO trên Maximo trước khi route/);
});
