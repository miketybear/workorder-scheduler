import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlanUploadBatch } from './PlanUploadBatch';
import type { PlanUploadBatch as Batch, PlanUploadBatchItem } from '../api/assignments';

const api = vi.hoisted(() => ({ latest: vi.fn(), page: vi.fn(), create: vi.fn(), prepare: vi.fn(), confirm: vi.fn(), lookup: vi.fn(), continue: vi.fn() }));
vi.mock('../api/assignments', async (original) => ({ ...await original<object>(),
  getLatestPlanUploadBatch: api.latest, getPlanUploadBatch: api.page, createPlanUploadBatch: api.create,
  prepareNextPlanUploadBatch: api.prepare, confirmPlanUploadBatch: api.confirm,
  lookupPlanUploadBatchSubmission: api.lookup, continuePlanUploadBatch: api.continue,
}));

const item = (state: PlanUploadBatchItem['state'] = 'ready', index = 1): PlanUploadBatchItem => ({
  item_id: `item-${index}`, kind: 'plan', state, reason: null, plan_id: `plan-${index}`, allocation_id: `allocation-${index}`,
  connection_id: 'conn', site_id: 'SITE', workorder_id: String(index), wonum: `WO-${index}`, workorder_description: `Repair ${index}`,
  task_workorder_id: `task-${index}`, task_id: index, task_description: 'Repair', person_id: 'person', person_name: 'Linh', laborcode: 'L1',
  source_assignment_id: `source-${index}`, plan_version: 1, total_minutes: 60,
  segments: [{ allocation_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, version: 1, date: '2026-10-05', minutes: 60,
    scheduled_start: '2026-10-05T06:30:00Z', scheduled_finish: '2026-10-05T07:30:00Z' }], attempt_id: null, receipt: null,
});
const counts = (state: 'pending' | 'ready' | 'confirmed', total = 1) => ({ total, pending: state === 'pending' ? total : 0, ready: state === 'ready' ? total : 0,
  blocked: 0, skipped: 0, queued: 0, sending: 0, confirmed: state === 'confirmed' ? total : 0, failed: 0, conflict: 0, unknown: 0 });
function batch(state: Batch['state'], row: PlanUploadBatchItem, requestId = 'create-request'): Batch {
  const status = row.state === 'pending' ? 'pending' : row.state === 'confirmed' ? 'confirmed' : 'ready';
  return { batch_id: 'batch', request_id: requestId, confirmation_request_id: null, pool_id: 'pool', connection_id: 'conn', discipline: 'MECH',
    month: '2026-10', start_time: '06:30', state, expires_at: state === 'ready' ? '2099-10-05T12:00:00Z' : null, counts: counts(status, 1),
    next_item_id: state === 'previewing' ? row.item_id : null, items: [row], has_more: false, next_cursor: null, changed_item: null };
}
const props = { poolId: 'pool', connectionId: 'conn', discipline: 'MECH', month: '2026-10', timezone: 'UTC', connectionLabel: 'Onshore test',
  writable: true, verify: vi.fn().mockResolvedValue(undefined), onLock: vi.fn(), onClose: vi.fn(), onConfirmed: vi.fn(), onReconcile: vi.fn() };
const sendButton = () => {
  const button = screen.getAllByRole('button').find((candidate) => candidate.textContent?.trim().startsWith('G'));
  if (!button) throw new Error('The batch is not ready to confirm.');
  return button;
};
beforeEach(() => { vi.clearAllMocks(); api.latest.mockResolvedValue(null); });

it('creates and prepares the first batch only after clicking create, using the chosen start time', async () => {
  const waiting = batch('previewing', item('pending'));
  const ready = batch('ready', item('ready'));
  api.create.mockResolvedValue(waiting); api.prepare.mockResolvedValue(ready); api.page.mockResolvedValue(ready);
  render(<PlanUploadBatch {...props} />);
  const create = (await screen.findAllByRole('button')).at(-1)!;
  expect(create).toBeEnabled();
  expect(api.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: '07' } });
  fireEvent.click(screen.getAllByRole('button').at(-1)!);
  await screen.findByText(/WO-1/);
  expect(api.create).toHaveBeenCalledWith('pool', { connection_id: 'conn', discipline: 'MECH', month: '2026-10' }, expect.any(String), '07:30', expect.any(AbortSignal));
  expect(api.prepare).toHaveBeenCalledTimes(1);
  expect(sendButton()).toBeEnabled();
});

it('filters a completed multi-item batch with status chips and closes from the dialog', async () => {
  const rows = [item('confirmed'), item('failed', 2), { ...item('unknown', 3), attempt_id: 'attempt',
    receipt: { attempt_id: 'attempt', request_id: 'request', plan_id: 'plan-3', state: 'unknown' as const, mapping: null } }];
  const completed = { ...batch('completed', rows[0]!), counts: { ...counts('confirmed', 1), failed: 1, unknown: 1 }, items: rows };
  api.latest.mockResolvedValue(completed); api.page.mockResolvedValue(completed);
  render(<PlanUploadBatch {...props} />);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/WO-1/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getAllByRole('button')[2]!);
  expect(within(dialog).getByText(/WO-2/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/WO-1/)).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getAllByRole('button')[2]!);
  expect(within(dialog).getByText(/WO-3/)).toBeInTheDocument();
  const reconcileButton = within(dialog).getAllByRole('button').find((button) => button.closest('td'))!;
  fireEvent.click(reconcileButton);
  expect(props.onReconcile).toHaveBeenCalledWith(rows[2]);
  fireEvent.click(within(dialog).getAllByRole('button')[0]!);
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('confirms a ready batch once, displays the confirmed outcome and offers a fresh preview', async () => {
  const ready = batch('ready', item('ready'));
  const done = batch('completed', item('confirmed'));
  api.latest.mockResolvedValue(ready); api.page.mockResolvedValue(ready); api.confirm.mockResolvedValue(done); api.page.mockResolvedValueOnce(ready).mockResolvedValue(done);
  render(<PlanUploadBatch {...props} />);
  await screen.findByText(/WO-1/);
  fireEvent.click(sendButton());
  await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(1));
  await screen.findByRole('status');
  expect(api.confirm).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('button').some((button) => button.textContent?.trim().startsWith('G'))).toBe(false);
});

it('recovers an ambiguous confirmation by lookup and never confirms the same batch twice', async () => {
  const ready = batch('ready', item('ready'));
  api.latest.mockResolvedValue(ready); api.page.mockResolvedValue(ready);
  api.confirm.mockRejectedValue(new Error('lost response')); api.lookup.mockResolvedValue(null);
  render(<PlanUploadBatch {...props} />);
  await screen.findByText(/WO-1/);
  fireEvent.click(sendButton());
  await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1));
  const recover = screen.getAllByRole('alert').find((alert) => alert.querySelector('button'))!.querySelector('button')!;
  expect(api.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(recover);
  await screen.findByRole('alert');
  expect(api.lookup).toHaveBeenCalledTimes(2);
  expect(api.confirm).toHaveBeenCalledTimes(1);
});

it('pages through a 50-row batch and keeps previous/next controls bounded', async () => {
  const rows = Array.from({ length: 50 }, (_, index) => item('ready', index + 1));
  const first = { ...batch('ready', rows[0]!), counts: counts('ready', 50), items: rows.slice(0, 20), has_more: true, next_cursor: 'next' };
  const second = { ...first, items: rows.slice(20, 40), has_more: true, next_cursor: 'last' };
  const third = { ...first, items: rows.slice(40), has_more: false, next_cursor: null };
  api.latest.mockResolvedValue(first); api.page.mockImplementation(async (_pool: string, _id: string, _scope: unknown, cursor: string) => cursor === '0' ? first : cursor === 'next' ? second : third);
  render(<PlanUploadBatch {...props} />);
  const nav = await screen.findByRole('navigation');
  expect(within(nav).getByText(/Trang 1/)).toBeInTheDocument();
  expect(within(nav).getAllByRole('button')[0]).toBeDisabled();
  fireEvent.click(within(nav).getAllByRole('button')[1]!);
  await waitFor(() => expect(within(nav).getByText(/Trang 2/)).toBeInTheDocument());
  fireEvent.click(within(nav).getAllByRole('button')[1]!);
  await waitFor(() => expect(within(nav).getByText(/Trang 3/)).toBeInTheDocument());
  expect(screen.getByText(/WO-50/)).toBeInTheDocument();
  expect(within(nav).getAllByRole('button')[1]).toBeDisabled();
});

it('recovers an ambiguous batch creation by lookup without repeating the create request', async () => {
  const ready = batch('ready', item('ready'));
  api.create.mockRejectedValue(new TypeError('response lost'));
  api.lookup.mockResolvedValue(ready); api.page.mockResolvedValue(ready);
  render(<PlanUploadBatch {...props} />);
  await waitFor(() => expect(screen.getAllByRole('button').some((button) => button.textContent?.trim().startsWith('T'))).toBe(true));
  fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('T'))!);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.querySelector('button'))).toBe(true));
  const recover = screen.getAllByRole('alert').find((alert) => alert.querySelector('button'))!.querySelector('button')!;
  fireEvent.click(recover);
  await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1));
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(sendButton()).toBeEnabled();
});

it('refreshes the queued batch before continuing and reloads status on request', async () => {
  const queued = { ...batch('completed', item('queued')), state: 'running' as const,
    counts: { ...counts('pending'), pending: 0, queued: 1 }, next_item_id: 'item-1' };
  const done = batch('completed', item('confirmed'));
  api.latest.mockResolvedValue(queued); api.page.mockResolvedValue(queued); api.continue.mockResolvedValue(done);
  render(<PlanUploadBatch {...props} />);
  await screen.findByText(/WO-1/);
  const resume = screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Tiếp tục'))!;
  fireEvent.click(resume);
  await waitFor(() => expect(api.continue).toHaveBeenCalledTimes(1));
  expect(api.page).toHaveBeenCalledTimes(2);
  const reload = screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Tải lại'))!;
  fireEvent.click(reload);
  await waitFor(() => expect(api.latest).toHaveBeenCalledTimes(2));
});

it('offers a fresh preview when the saved preview expired and submits a replacement', async () => {
  const expired = { ...batch('ready', item('ready')), expires_at: '2000-01-01T00:00:00Z' };
  const waiting = batch('previewing', item('pending'));
  const ready = batch('ready', item('ready'));
  api.latest.mockResolvedValue(expired); api.page.mockResolvedValueOnce(expired).mockResolvedValue(ready);
  api.create.mockResolvedValue(waiting); api.prepare.mockResolvedValue(ready);
  render(<PlanUploadBatch {...props} />);
  await screen.findByText(/WO-1/);
  const newPreview = screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Tạo'))!;
  fireEvent.click(newPreview);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.prepare).toHaveBeenCalledTimes(1);
  expect(api.create.mock.calls[0][0]).toBe('pool');
});

it('lets the planner click every populated status chip and open reconciliation for an unknown row', async () => {
  const rows: PlanUploadBatchItem[] = [item('ready'), item('blocked', 2), item('skipped', 3), item('confirmed', 4),
    item('failed', 5), item('conflict', 6), { ...item('unknown', 7), attempt_id: 'attempt',
      receipt: { attempt_id: 'attempt', request_id: 'request', plan_id: 'plan-7', state: 'unknown', mapping: null } }, item('queued', 8)];
  const completed = { ...batch('completed', rows[0]!), counts: { total: 8, pending: 0, ready: 1, blocked: 1, skipped: 1,
    queued: 1, sending: 0, confirmed: 1, failed: 1, conflict: 1, unknown: 1 }, items: rows };
  api.latest.mockResolvedValue(completed); api.page.mockResolvedValue(completed);
  render(<PlanUploadBatch {...props} />);
  await screen.findByText(/WO-1/);
  const chips = () => screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'));
  expect(chips()).toHaveLength(7);
  for (let index = 0; index < 7; index += 1) fireEvent.click(chips()[index]!);
  fireEvent.click(chips()[5]!);
  expect(chips().some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  const rowAction = screen.getAllByRole('button').find((button) => button.closest('td'))!;
  fireEvent.click(rowAction);
  expect(props.onReconcile).toHaveBeenCalledWith(rows[6]);
  const clear = screen.getAllByRole('button').find((button) => button.textContent?.trim().startsWith('Xem'))!;
  fireEvent.click(clear);
  expect(chips().every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
});
