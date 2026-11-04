import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getChildren } from '../api/drafts';
import { RetrievalError } from '../api/workOrders';
import { ChildWorkOrders } from './ChildWorkOrders';

vi.mock('../api/drafts', async (original) => ({ ...await original<object>(), getChildren: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });
const identity = { connection_id: 'one', discipline: 'E&I', site_id: 'BD1', workorder_id: '100' };
const open = (container: HTMLElement) => {
  const details = container.querySelector('details') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
};

it('reads nothing until opened, then shows read-only rows and the count', async () => {
  vi.mocked(getChildren).mockResolvedValue([
    { workorderid: '1', wonum: 'P1', location: 'HT-1', estdur: 1.6333333333333333, plusgsafetycrit: true },
    { workorderid: '3', wonum: 'P3', location: 'HT-3', estdur: 5, plusgsafetycrit: false },
    { workorderid: '2', wonum: 'P2', location: null, estdur: null, plusgsafetycrit: null },
  ]);
  const { container } = render(<ChildWorkOrders identity={identity} onDenied={vi.fn()} />);
  expect(getChildren).not.toHaveBeenCalled();
  open(container);
  expect(await screen.findByText('WO con (3)')).toBeInTheDocument();
  const row = screen.getByText('P1').closest('tr') as HTMLElement;
  expect(within(row).getByText('HT-1')).toBeInTheDocument();
  expect(within(row).getByText('1.63')).toBeInTheDocument();
  expect(within(row).getByRole('img', { name: 'Là SCE' })).toBeInTheDocument();
  expect(within(screen.getByText('P3').closest('tr') as HTMLElement).getByRole('img', { name: 'Không phải SCE' })).toBeInTheDocument();
  expect(container.querySelectorAll('input, select, button')).toHaveLength(0);
});

it('says when there are no children', async () => {
  vi.mocked(getChildren).mockResolvedValue([]);
  const { container } = render(<ChildWorkOrders identity={identity} onDenied={vi.fn()} />);
  open(container);
  expect(await screen.findByText('WO này không có WO con.')).toBeInTheDocument();
});

it('keeps a read failure inside the section and can retry', async () => {
  vi.mocked(getChildren).mockRejectedValueOnce(new Error('Maximo lỗi')).mockResolvedValue([]);
  const onDenied = vi.fn();
  const { container } = render(<ChildWorkOrders identity={identity} onDenied={onDenied} />);
  open(container);
  fireEvent.click(await screen.findByText('Thử lại'));
  expect(await screen.findByText('WO này không có WO con.')).toBeInTheDocument();
  expect(onDenied).not.toHaveBeenCalled();
});

it('treats a lost session as denied', async () => {
  vi.mocked(getChildren).mockRejectedValue(new RetrievalError(401, 'x'));
  const onDenied = vi.fn();
  const { container } = render(<ChildWorkOrders identity={identity} onDenied={onDenied} />);
  open(container);
  await vi.waitFor(() => expect(onDenied).toHaveBeenCalled());
});
