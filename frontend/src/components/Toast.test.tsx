import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Toast } from './Toast';

it('closes itself after five seconds', () => {
  vi.useFakeTimers();
  const onClose = vi.fn();
  render(<Toast message="Đã upload 1 WO" onClose={onClose} />);
  expect(screen.getByRole('status')).toHaveTextContent('Đã upload 1 WO');
  act(() => { vi.advanceTimersByTime(4999); });
  expect(onClose).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(onClose).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
