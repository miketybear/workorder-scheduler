import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { getAuthSummary } from '../api/client';
import { UserMenu } from './UserMenu';

vi.mock('../api/client', () => ({ getAuthSummary: vi.fn(), signOut: vi.fn(), loginUrl: '/api/auth/login' }));
vi.mock('./Admin', () => ({ AdminLink: () => null }));
afterEach(() => vi.resetAllMocks());

const grant = { connection_id: 'one', label: 'Onshore production', system: 'onshore' as const, environment: 'production' as const,
  timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'write' as const };

it('shows the active environment and account grants', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: {
    user: { id: 'u', name: 'Planner', is_admin: false }, preferred_connection_id: 'one', grants: [grant] } });
  render(<MemoryRouter><UserMenu /></MemoryRouter>);
  expect(await screen.findByText('Onshore · PROD')).toHaveAttribute('data-env', 'production');
  expect(screen.getByText(/Onshore production · MECH · Xem và sửa/)).toBeInTheDocument();
});

it('asks to choose a connection when several grants are ambiguous', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: {
    user: { id: 'u', name: 'Planner', is_admin: false }, grants: [grant, { ...grant, connection_id: 'two' }] } });
  render(<MemoryRouter><UserMenu /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Chọn kết nối' })).toHaveAttribute('href', '/settings');
});
