import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { DateTimeInput } from './DateTimeInput';

function Harness({ initial = '', onChange = vi.fn(), parentKey = vi.fn(), defaultTime = '06:30' }: { initial?: string; onChange?: (value: string) => void; parentKey?: () => void; defaultTime?: string }) {
  const [value, setValue] = useState(initial);
  return <div onKeyDown={parentKey}><DateTimeInput label="Scheduled Start" value={value} defaultTime={defaultTime} today="2026-10-20"
    onChange={(next) => { setValue(next); onChange(next); }} /></div>;
}
const field = () => screen.getByLabelText('Scheduled Start (nhập)') as HTMLInputElement;
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày giờ Scheduled Start' }));

it('shows a 24 hour value and accepts typed dd/mm/yyyy hh:mm', () => {
  const onChange = vi.fn();
  render(<Harness initial="2026-10-01T20:05" onChange={onChange} />);
  expect(field()).toHaveValue('01/10/2026 20:05');
  fireEvent.change(field(), { target: { value: '02/10/2026 09:58' } });
  fireEvent.blur(field());
  expect(onChange).toHaveBeenLastCalledWith('2026-10-02T09:58');
  expect(field()).toHaveValue('02/10/2026 09:58');
});

it('keeps an invalid entry visible with an alert and does not emit a change', () => {
  const onChange = vi.fn();
  render(<Harness initial="2026-10-01T08:00" onChange={onChange} />);
  fireEvent.change(field(), { target: { value: '31/02/2026 08:00' } });
  fireEvent.blur(field());
  expect(screen.getByRole('alert')).toHaveTextContent('hh:mm (24 giờ)');
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(field()).toHaveValue('31/02/2026 08:00');
  expect(onChange).not.toHaveBeenCalled();
});

it('applies the default time to a typed date and clears on empty text', () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.change(field(), { target: { value: '15/10/2026' } });
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith('2026-10-15T06:30');
  fireEvent.change(field(), { target: { value: '' } });
  fireEvent.blur(field());
  expect(onChange).toHaveBeenLastCalledWith('');
});

it('picks the day, hour and 5-minute step from one popup and applies each pick immediately', () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  open();
  const popup = screen.getByRole('dialog', { name: 'Chọn Scheduled Start' });
  expect(within(popup).getByText('Tháng 10/2026')).toBeInTheDocument();
  expect(within(popup).getAllByRole('button', { name: /^\d{2}\/\d{2}\/\d{4}$/ })).toHaveLength(42);
  // Hours are disabled until a day is chosen.
  expect(within(popup).getByRole('button', { name: '09 giờ' })).toBeDisabled();
  fireEvent.click(within(popup).getByRole('button', { name: '08/10/2026' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-08T06:30');
  fireEvent.click(within(popup).getByRole('button', { name: '09 giờ' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-08T09:30');
  expect(within(popup).getAllByRole('button', { name: /phút$/ })).toHaveLength(12);
  fireEvent.click(within(popup).getByRole('button', { name: '45 phút' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-10-08T09:45');
  expect(field()).toHaveValue('08/10/2026 09:45');
  fireEvent.click(within(popup).getByRole('button', { name: 'Xong' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('shows an off-grid minute as selected and moves between months', () => {
  render(<Harness initial="2026-10-08T09:58" />);
  open();
  const popup = screen.getByRole('dialog');
  expect(within(popup).getByRole('button', { name: '58 phút' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(popup).getByRole('button', { name: '08/10/2026' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(popup).getByRole('button', { name: 'Tháng sau' }));
  expect(within(popup).getByText('Tháng 11/2026')).toBeInTheDocument();
  // Picking a day shown from the neighbouring month switches to that month.
  fireEvent.click(within(popup).getByRole('button', { name: '30/11/2026' }));
  expect(field()).toHaveValue('30/11/2026 09:58');
});

it('closes on Escape without letting the surrounding dialog see the key, and on an outside click', () => {
  const parentKey = vi.fn();
  render(<Harness parentKey={parentKey} />);
  open();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(parentKey).not.toHaveBeenCalled();
  expect(field()).toHaveFocus();
  open();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('moves between days with the arrow keys', () => {
  render(<Harness initial="2026-10-08T09:30" />);
  open();
  const day = screen.getByRole('button', { name: '08/10/2026' });
  day.focus();
  fireEvent.keyDown(day, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: '09/10/2026' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('button', { name: '09/10/2026' }), { key: 'ArrowDown' });
  expect(screen.getByRole('button', { name: '16/10/2026' })).toHaveFocus();
});

it('does not open when disabled', () => {
  render(<DateTimeInput label="Target Start" value="" disabled onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Chọn ngày giờ Target Start' })).toBeDisabled();
  expect(screen.getByLabelText('Target Start (nhập)')).toBeDisabled();
});
