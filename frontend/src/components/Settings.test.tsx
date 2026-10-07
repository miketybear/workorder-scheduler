import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getConnectionSettings, saveConnectionSetting, type ConnectionSettings } from '../api/settings';
import { RetrievalError } from '../api/workOrders';
import { Settings } from './Settings';

vi.mock('../api/settings', () => ({ getConnectionSettings: vi.fn(), saveConnectionSetting: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const data: ConnectionSettings = { session: { user: { id: 'user', name: 'Planner', is_admin: false }, preferred_connection_id: 'one', grants: [
  { connection_id: 'one', label: 'Onshore test', system: 'onshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'read' },
  { connection_id: 'two', label: 'Offshore test', system: 'offshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'write' },
] }, connections: [{ connection_id: 'one', url: 'https://onshore.invalid/maximo' }, { connection_id: 'two', url: 'https://offshore.invalid/maximo' }] };
function setup() { render(<MemoryRouter><Settings /></MemoryRouter>); }

it('shows approved URLs and saves a changed connection for the signed-in account', async () => {
  vi.mocked(getConnectionSettings).mockResolvedValue(data);
  vi.mocked(saveConnectionSetting).mockResolvedValue();
  setup();
  expect(await screen.findByRole('radio', { name: /Onshore test/ })).toBeChecked();
  expect(screen.getByText('https://offshore.invalid/maximo')).toBeVisible();
  expect(screen.getByText('Lưu hệ thống')).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: /Offshore test/ }));
  fireEvent.click(screen.getByText('Lưu hệ thống'));
  await screen.findByText(/Đã lưu hệ thống cho tài khoản/);
  expect(saveConnectionSetting).toHaveBeenCalledWith('two', expect.any(AbortSignal));
  expect(screen.getByText('Lưu hệ thống')).toBeDisabled();
});
it('retains the selected connection after a recoverable error and hides it after session expiry', async () => {
  vi.mocked(getConnectionSettings).mockResolvedValue(data);
  vi.mocked(saveConnectionSetting).mockRejectedValue(new Error('Offline'));
  setup();
  fireEvent.click(await screen.findByRole('radio', { name: /Offshore test/ }));
  fireEvent.click(screen.getByText('Lưu hệ thống'));
  await screen.findByText('Offline');
  expect(screen.getByRole('radio', { name: /Offshore test/ })).toBeChecked();
  vi.mocked(getConnectionSettings).mockRejectedValue(new RetrievalError(401, 'Expired'));
  await act(async () => fireEvent(document, new Event('visibilitychange')));
  await screen.findByText('Đăng nhập Microsoft');
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
it('does not let a user choose a discipline when a connection has ambiguous grants', async () => {
  vi.mocked(getConnectionSettings).mockResolvedValue({ ...data, session: { ...data.session,
    grants: [...data.session.grants, { ...data.session.grants[0], discipline: 'E&I' }] } });
  setup();
  expect(await screen.findByRole('radio', { name: /Onshore test/ })).toBeDisabled();
  await waitFor(() => expect(screen.getByText('Lưu hệ thống')).toBeDisabled());
});
