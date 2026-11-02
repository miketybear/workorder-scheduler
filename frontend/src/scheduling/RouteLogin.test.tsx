import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createRouteSession, RouteApiError } from '../api/workflowRoute';
import { RouteLogin } from './RouteLogin';

vi.mock('../api/workflowRoute', async (original) => ({
  ...await original<typeof import('../api/workflowRoute')>(),
  createRouteSession: vi.fn(),
}));

const scope = { connection_id: 'c1', discipline: 'E&I' };
beforeEach(() => { vi.mocked(createRouteSession).mockReset(); });

function open() {
  const handlers = { onSession: vi.fn(), onSkip: vi.fn(), onDenied: vi.fn() };
  render(<RouteLogin scope={scope} personid="ENISUP" {...handlers} />);
  return handlers;
}

function submit(password: string) {
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

it('sends the password once, clears it and reports the saved login', async () => {
  const session = { active: true, expires_at: null };
  vi.mocked(createRouteSession).mockResolvedValue(session);
  const { onSession } = open();
  submit('secret');
  expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('');
  await waitFor(() => expect(onSession).toHaveBeenCalledWith(session));
  expect(vi.mocked(createRouteSession).mock.calls[0].slice(0, 3)).toEqual([scope, 'ENISUP', 'secret']);
});

it('shows the remaining attempts after a wrong password', async () => {
  vi.mocked(createRouteSession).mockRejectedValue(new RouteApiError(422, 'maximo_login_failed', 'x', { remaining_attempts: 2 }));
  const { onSession } = open();
  submit('wrong');
  await screen.findByText(/Sai mật khẩu của ENISUP\. Còn 2 lần thử/);
  expect(onSession).not.toHaveBeenCalled();
});

it('can be skipped without sending anything', () => {
  const { onSkip } = open();
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }));
  expect(onSkip).toHaveBeenCalled();
  expect(createRouteSession).not.toHaveBeenCalled();
});
