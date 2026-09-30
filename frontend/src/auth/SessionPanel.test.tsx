import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthSummary, signOut } from '../api/client';
import { SessionPanel } from './SessionPanel';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn(), signOut: vi.fn(), loginUrl: '/api/auth/login' }));
afterEach(() => vi.resetAllMocks());

describe('session access', () => {
  it('offers login only when configured', async () => {
    vi.mocked(getAuthSummary).mockResolvedValue({ available: false, session: null });
    render(<SessionPanel />);
    await screen.findByText('Chờ cấu hình đăng nhập từ IT.');
    expect(screen.queryByText('Đăng nhập Microsoft')).not.toBeInTheDocument();
    vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: null });
    fireEvent(window, new Event('focus'));
    expect(await screen.findByText('Đăng nhập Microsoft')).toHaveAttribute('href', '/api/auth/login');
  });

  it('does not give an administrator WO access without grants', async () => {
    vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: {
      user: { id: 'user', name: 'Test Admin', is_admin: true }, grants: [],
    } });
    render(<SessionPanel />);
    await screen.findByText('Test Admin');
    expect(screen.getByText(/Chưa được cấp quyền WO/)).toBeInTheDocument();
    vi.mocked(signOut).mockRejectedValue(new Error('Offline'));
    fireEvent.click(screen.getByText('Đăng xuất khỏi ứng dụng'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đăng xuất được');
  });

  it('clears old identity when session expires', async () => {
    vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: {
      user: { id: 'user', name: 'Planner', is_admin: false },
      grants: [{ connection_id: 'one', label: 'Onshore test', system: 'onshore', environment: 'test', discipline: 'MECH', capability: 'write' }],
    } });
    render(<SessionPanel />);
    await screen.findByText(/Onshore test/);
    vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: null });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.queryByText('Planner')).not.toBeInTheDocument());
    expect(screen.queryByText(/Onshore test/)).not.toBeInTheDocument();
    await screen.findByText('Đăng nhập Microsoft');
  });
});

