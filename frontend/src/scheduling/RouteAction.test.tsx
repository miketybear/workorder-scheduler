import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RouteAction } from './RouteAction';

afterEach(cleanup);

it('routes only from a ready button and opens the tip on focus without changing the cell', () => {
  const onRoute = vi.fn();
  render(<RouteAction kind="ready" label="Route P1 đến PIC" text="Sẵn sàng route đến TECH" onRoute={onRoute} />);
  const button = screen.getByRole('button', { name: 'Route P1 đến PIC' });
  expect(button).not.toHaveAttribute('aria-disabled');
  fireEvent.focus(button);
  expect(document.querySelector('[aria-hidden="true"][class*=routeTip]')).toHaveTextContent('Sẵn sàng route đến TECH');
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(document.querySelector('[class*=routeTip]')).toBeNull();
  fireEvent.click(button);
  expect(onRoute).toHaveBeenCalledOnce();
});

it('keeps a blocked button focusable, describes the reason and never routes', () => {
  const onRoute = vi.fn();
  render(<RouteAction kind="blocked" label="Route P2 đến PIC" text="Thiếu lịch bắt đầu/kết thúc" onRoute={onRoute} />);
  const button = screen.getByRole('button', { name: 'Route P2 đến PIC' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAccessibleDescription('Thiếu lịch bắt đầu/kết thúc');
  fireEvent.click(button);
  expect(onRoute).not.toHaveBeenCalled();
  expect(document.querySelector('[class*=routeTip]')).toHaveTextContent('Thiếu lịch bắt đầu/kết thúc');
  fireEvent.click(button);
  expect(document.querySelector('[class*=routeTip]')).toBeNull();
});

it('shows routed, lost and unknown outcomes as status icons, none of them routable', () => {
  const onRoute = vi.fn();
  for (const [kind, text] of [['done', 'Đã route · VIETLV'], ['stranded', 'Mất việc: cần admin Maximo khởi động lại workflow'], ['unknown', 'Chưa rõ kết quả']] as const) {
    const { unmount } = render(<RouteAction kind={kind} label={`Route ${kind}`} text={text} onRoute={onRoute} />);
    const button = screen.getByRole('button', { name: `Route ${kind}` });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(text);
    expect(button.querySelector('svg')).not.toBeNull();
    fireEvent.click(button);
    unmount();
  }
  expect(onRoute).not.toHaveBeenCalled();
});
