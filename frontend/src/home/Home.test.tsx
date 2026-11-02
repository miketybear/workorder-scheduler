import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { parseHomeSummary, type HomeSummary } from '../api/home';
import { Home, homeTasks } from './Home';

const session = { user: { id: 'u', name: 'Pat', is_admin: false }, preferred_connection_id: 'c',
  grants: [{ connection_id: 'c', label: 'Onshore test', system: 'onshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'E&I', capability: 'write' }] };
const summary: HomeSummary = { total: 55, missing_schedule: 50, missing_pic: 12, overdue: 3, drafts: 2, unresolved_uploads: 1, unresolved_routes: 0, as_of: '2026-11-02T08:00:00+00:00' };

vi.mock('../api/client', async (original) => ({ ...await original<typeof import('../api/client')>(), getAuthSummary: vi.fn(() => Promise.resolve({ available: true, session })) }));
vi.mock('../auth/SessionPanel', () => ({ SessionPanel: () => null }));
afterEach(() => vi.unstubAllGlobals());

const show = () => render(<MemoryRouter><Home /></MemoryRouter>);
const respond = (ok: boolean, body: unknown) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })));

it('orders tasks by urgency and hides empty ones', () => {
  expect(homeTasks(summary).map((task) => task.text)).toEqual(['WO upload chưa rõ kết quả', 'WO đã quá Target Date', 'WO chưa có lịch', 'WO chưa có PIC']);
});

it('refuses a partial answer rather than showing zero', () => {
  expect(() => parseHomeSummary({ ...summary, overdue: undefined })).toThrow();
});

it('shows metrics and tasks for the granted scope', async () => {
  respond(true, summary);
  show();
  expect(await screen.findByText('WO trong tháng')).toBeInTheDocument();
  expect(screen.getByText('55')).toBeInTheDocument();
  expect(screen.getByText('WO upload chưa rõ kết quả').closest('a')).toHaveAttribute('href', '/work-orders');
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('discipline=E%26I');
});

it('says the numbers are unavailable instead of showing zeros when Maximo fails', async () => {
  respond(false, null);
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đọc được số liệu');
  expect(screen.queryByText('WO trong tháng')).not.toBeInTheDocument();
});

it('says so when nothing is left to do', async () => {
  respond(true, { ...summary, missing_schedule: 0, missing_pic: 0, overdue: 0, unresolved_uploads: 0 });
  show();
  expect(await screen.findByText('Không còn việc cần xử lý trong tháng này.')).toBeInTheDocument();
});
