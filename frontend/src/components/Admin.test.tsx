import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getAuthSummary } from '../api/client';
import { getAdminRoster, savePlannerPermission, type AdminRoster } from '../api/admin';
import { Admin } from './Admin';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn() }));
vi.mock('../api/admin', () => ({ getAdminRoster: vi.fn(), savePlannerPermission: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const session = { available: true, session: { user: { id: 'admin', name: 'Admin', is_admin: true }, grants: [] } } as Awaited<ReturnType<typeof getAuthSummary>>;
const roster: AdminRoster = {
  users: [{ id: 'planner', tenant_id: 'tenant', object_id: 'object', display_name: 'Planner', active: true, is_admin: false }],
  connections: [{ id: 'onshore-test', label: 'Onshore test', system: 'onshore', environment: 'test', enabled: true, disciplines: ['E&I'] }],
  permissions: [], grants: [],
};
function setup() { render(<MemoryRouter><Admin /></MemoryRouter>); }
async function selectScope(discipline = 'E&I') {
  fireEvent.change(await screen.findByLabelText('Tài khoản'), { target: { value: 'planner' } });
  fireEvent.change(screen.getByLabelText('Kết nối'), { target: { value: 'onshore-test' } });
  fireEvent.change(screen.getByLabelText('Discipline'), { target: { value: discipline } });
}
function enterReason(value = 'Approved by operations') {
  fireEvent.change(screen.getByLabelText('Lý do'), { target: { value } });
}

it('requires a reason and reloads confirmed assignment state after a change', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue(session);
  vi.mocked(getAdminRoster).mockResolvedValueOnce(roster).mockResolvedValueOnce({ ...roster,
    permissions: [{ user_id: 'planner', connection_id: 'onshore-test', discipline: 'E&I' }],
    grants: [{ user_id: 'planner', connection_id: 'onshore-test', discipline: 'E&I', capability: 'read' }],
  });
  vi.mocked(savePlannerPermission).mockResolvedValue();
  setup();
  await selectScope();
  const grant = screen.getByRole('button', { name: 'Cấp quyền' });
  expect(grant).toBeDisabled();
  enterReason();
  fireEvent.click(grant);
  await screen.findByText(/Đã cấp quyền và xác nhận trạng thái mới/);
  expect(savePlannerPermission).toHaveBeenCalledWith({ user_id: 'planner', connection_id: 'onshore-test', discipline: 'E&I', enabled: true, reason: 'Approved by operations' }, expect.any(AbortSignal));
  await waitFor(() => expect(screen.getByText(/Đã gán quyền Planner/)).toBeVisible());
  expect(screen.getByText(/Quyền hiệu lực gần nhất \(cache\): read/)).toBeVisible();
  const revoke = screen.getByRole('button', { name: 'Thu hồi quyền' });
  expect(revoke).toBeDisabled();
  enterReason('Planner changed assignment');
  expect(revoke).toBeEnabled();
});

it('hides roster for a non-admin session', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue({ ...session, session: { ...session.session!, user: { ...session.session!.user, is_admin: false } } });
  setup();
  expect(await screen.findByText('Tài khoản này không có quyền quản trị.')).toBeVisible();
  expect(getAdminRoster).not.toHaveBeenCalled();
});

it('clears the roster and prevents PUT when the admin identity changes before mutation', async () => {
  vi.mocked(getAuthSummary).mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session,
    session: { ...session.session!, user: { ...session.session!.user, id: 'different-admin' } },
  });
  vi.mocked(getAdminRoster).mockResolvedValue(roster);
  setup(); await selectScope(); enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền' }));
  expect(await screen.findByText('Phiên hoặc quyền quản trị đã thay đổi.')).toBeVisible();
  expect(savePlannerPermission).not.toHaveBeenCalled();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Lý do')).not.toBeInTheDocument();
});

it('hides the roster and waits for authorization before issuing the permission PUT', async () => {
  let verify!: (value: Awaited<ReturnType<typeof getAuthSummary>>) => void;
  const pendingVerification = new Promise<Awaited<ReturnType<typeof getAuthSummary>>>((resolve) => { verify = resolve; });
  vi.mocked(getAuthSummary).mockResolvedValueOnce(session).mockReturnValueOnce(pendingVerification);
  vi.mocked(getAdminRoster).mockResolvedValue(roster);
  setup(); await selectScope(); enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền' }));
  await waitFor(() => expect(getAuthSummary).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(savePlannerPermission).not.toHaveBeenCalled();
  verify({ ...session, session: { ...session.session!, user: { ...session.session!.user, is_admin: false } } });
  expect(await screen.findByText('Phiên hoặc quyền quản trị đã thay đổi.')).toBeVisible();
  expect(savePlannerPermission).not.toHaveBeenCalled();
});

it('fails closed when a session recheck fails and preserves intent after a recoverable PUT error', async () => {
  vi.mocked(getAuthSummary).mockResolvedValueOnce(session).mockResolvedValueOnce(session).mockRejectedValueOnce(new Error('Network unavailable'));
  vi.mocked(getAdminRoster).mockResolvedValue(roster);
  vi.mocked(savePlannerPermission).mockRejectedValueOnce(new Error('Server unavailable'));
  setup(); await selectScope(); enterReason('Keep this audit reason');
  fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền' }));
  expect(await screen.findByText('Server unavailable')).toBeVisible();
  expect(screen.getByLabelText('Tài khoản')).toHaveValue('planner');
  expect(screen.getByLabelText('Lý do')).toHaveValue('Keep this audit reason');
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
  expect(await screen.findByText('Network unavailable')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Lý do')).not.toBeInTheDocument();
});

it('aborts an old roster read when visibility triggers a fresh authorization check', async () => {
  let releaseOld!: (value: AdminRoster) => void;
  const oldRoster = new Promise<AdminRoster>((resolve) => { releaseOld = resolve; });
  vi.mocked(getAuthSummary).mockResolvedValue(session);
  vi.mocked(getAdminRoster).mockReturnValueOnce(oldRoster).mockResolvedValueOnce({ ...roster,
    users: [{ ...roster.users[0], id: 'fresh-planner', display_name: 'Fresh planner' }],
  });
  setup();
  await waitFor(() => expect(getAdminRoster).toHaveBeenCalledTimes(1));
  const staleSignal = vi.mocked(getAdminRoster).mock.calls[0][0];
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByRole('rowheader', { name: /Fresh planner/ })).toBeVisible();
  expect(staleSignal.aborted).toBe(true);
  releaseOld({ ...roster, users: [{ ...roster.users[0], id: 'stale-planner', display_name: 'Stale planner' }] });
  expect(screen.queryByRole('rowheader', { name: /Stale planner/ })).not.toBeInTheDocument();
});

it('allows revoking an assignment for a removed discipline on a disabled connection', async () => {
  const stale: AdminRoster = { ...roster,
    connections: [{ ...roster.connections[0], enabled: false, disciplines: [] }],
    permissions: [{ user_id: 'planner', connection_id: 'onshore-test', discipline: 'E&I' }],
  };
  vi.mocked(getAuthSummary).mockResolvedValue(session);
  vi.mocked(getAdminRoster).mockResolvedValue(stale);
  vi.mocked(savePlannerPermission).mockResolvedValue();
  setup(); await selectScope(); enterReason('Remove outdated grant');
  expect(screen.getByRole('button', { name: 'Cấp quyền' })).toBeDisabled();
  const revoke = screen.getByRole('button', { name: 'Thu hồi quyền' });
  expect(revoke).toBeEnabled();
  fireEvent.click(revoke);
  await waitFor(() => expect(savePlannerPermission).toHaveBeenCalledWith({ user_id: 'planner', connection_id: 'onshore-test', discipline: 'E&I', enabled: false, reason: 'Remove outdated grant' }, expect.any(AbortSignal)));
});

it('blocks further changes when a confirmed PUT cannot be verified by a fresh roster read', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue(session);
  vi.mocked(getAdminRoster).mockResolvedValueOnce(roster).mockRejectedValueOnce(new Error('Roster unavailable'))
    .mockResolvedValueOnce({ ...roster, permissions: [{ user_id: 'planner', connection_id: 'onshore-test', discipline: 'E&I' }] });
  vi.mocked(savePlannerPermission).mockResolvedValue();
  setup(); await selectScope(); enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Cấp quyền' }));
  expect(await screen.findByText('Đã lưu quyền nhưng chưa xác nhận được danh sách mới. Tải lại trước khi tiếp tục.')).toBeVisible();
  expect(screen.getByText('Roster unavailable')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cấp quyền' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
  expect(await screen.findByText(/Đã gán quyền Planner/)).toBeVisible();
});
