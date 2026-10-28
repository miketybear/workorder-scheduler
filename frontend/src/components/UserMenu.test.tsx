import { fireEvent, render, screen } from '@testing-library/react';
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

it('loads the signed-in user photo and falls back to their initial when it fails', async () => {
  vi.mocked(getAuthSummary).mockResolvedValue({ available: true, session: {
    user: { id: 'user/one', name: 'Planner', is_admin: false }, preferred_connection_id: 'one', grants: [grant] } });
  const { container } = render(<MemoryRouter><UserMenu /></MemoryRouter>);

  await screen.findByLabelText('Menu tài khoản · Planner');
  const image = container.querySelector('img');
  if (!image) throw new Error('Profile photo image was not rendered');
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('src', '/api/auth/photo?user=user%2Fone');
  expect(image.parentElement).toHaveAttribute('aria-hidden', 'true');
  fireEvent.error(image);
  expect(container.querySelector('img')).not.toBeInTheDocument();
  expect(screen.getByText('P')).toBeInTheDocument();
});

it('resets the failed photo state when the signed-in account changes', async () => {
  vi.mocked(getAuthSummary)
    .mockResolvedValueOnce({ available: true, session: {
      user: { id: 'first', name: 'Planner', is_admin: false }, preferred_connection_id: 'one', grants: [grant] } })
    .mockResolvedValueOnce({ available: true, session: {
      user: { id: 'second', name: 'Reviewer', is_admin: false }, preferred_connection_id: 'one', grants: [grant] } });
  const { container } = render(<MemoryRouter><UserMenu /></MemoryRouter>);

  await screen.findByLabelText('Menu tài khoản · Planner');
  const firstPhoto = container.querySelector('img');
  if (!firstPhoto) throw new Error('First profile photo image was not rendered');
  fireEvent.error(firstPhoto);
  expect(screen.getByText('P')).toBeInTheDocument();
  fireEvent(document, new Event('visibilitychange'));

  await screen.findByLabelText('Menu tài khoản · Reviewer');
  const replacementPhoto = container.querySelector('img');
  if (!replacementPhoto) throw new Error('Replacement profile photo image was not rendered');
  expect(replacementPhoto).toHaveAttribute('src', '/api/auth/photo?user=second');
  expect(screen.getByLabelText('Menu tài khoản · Reviewer')).toBeInTheDocument();
});
