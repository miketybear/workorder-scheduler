import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignmentError, getWorkOrderRelease, lookupWorkOrderRelease, releaseWorkOrder } from '../api/assignments';
import { WorkOrderRelease } from './WorkOrderRelease';

vi.mock('../api/assignments', async importOriginal => ({ ...await importOriginal<typeof import('../api/assignments')>(), getWorkOrderRelease: vi.fn(), releaseWorkOrder: vi.fn(), lookupWorkOrderRelease: vi.fn() }));
const preview = { allocation_ids: ['a', 'b'], task_count: 2, total_minutes: 1080, person_ids: ['p1'], kept_task_count: 1 };
const result = { request_id: 'r', items: [], released_task_count: 2, kept_task_count: 1 };
const props = () => ({ poolId: 'pool', allocationId: 'a', label: 'H1', personName: () => 'Dao Quang Hai', verify: vi.fn(async () => undefined), onReleased: vi.fn(async () => undefined), onClose: vi.fn(), onBusyChange: vi.fn() });

beforeEach(() => { vi.clearAllMocks(); vi.mocked(getWorkOrderRelease).mockResolvedValue(preview); });

it('shows what will be removed and kept, then sends the shown rows once', async () => {
  const shown = props();
  vi.mocked(releaseWorkOrder).mockResolvedValue(result as never);
  render(<WorkOrderRelease {...shown} />);
  expect(await screen.findByText('Xóa 2 task, 18 giờ của H1?')).toBeInTheDocument();
  expect(screen.getByText(/Dao Quang Hai/)).toBeInTheDocument();
  expect(screen.getByText('1 task đã gửi lên Maximo sẽ được giữ nguyên.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa tất cả' }));
  await waitFor(() => expect(shown.onReleased).toHaveBeenCalledWith(result));
  expect(vi.mocked(releaseWorkOrder).mock.calls[0][2].expected_allocation_ids).toEqual(['a', 'b']);
});

it('offers no delete when nothing can be removed', async () => {
  vi.mocked(getWorkOrderRelease).mockResolvedValue({ ...preview, allocation_ids: [], task_count: 0, total_minutes: 0 });
  render(<WorkOrderRelease {...props()} />);
  expect(await screen.findByText('Không có phân công nào của H1 có thể xóa.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).not.toBeInTheDocument();
});

it('never resends after an unclear outcome and reconciles by receipt', async () => {
  const shown = props();
  vi.mocked(releaseWorkOrder).mockRejectedValue(new TypeError('network'));
  vi.mocked(lookupWorkOrderRelease).mockResolvedValue(result as never);
  render(<WorkOrderRelease {...shown} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Xóa tất cả' }));
  const check = await screen.findByRole('button', { name: 'Kiểm tra kết quả' });
  expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).not.toBeInTheDocument();
  fireEvent.click(check);
  await waitFor(() => expect(shown.onReleased).toHaveBeenCalledWith(result));
  expect(releaseWorkOrder).toHaveBeenCalledTimes(1);
});

it('asks to start over when the list changed', async () => {
  vi.mocked(releaseWorkOrder).mockRejectedValue(new AssignmentError(409, 'Danh sách đã đổi.'));
  render(<WorkOrderRelease {...props()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Xóa tất cả' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Danh sách đã đổi.');
  expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).not.toBeInTheDocument();
});
