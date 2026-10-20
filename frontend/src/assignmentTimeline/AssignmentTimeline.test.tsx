import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssignmentTimelineDemo } from './AssignmentTimelineDemo';
import { initialRoster } from './fixtures';
import { setDate } from '../testDateTime';
import { availability, monthDays } from './model';

describe('AssignmentTimelineDemo', () => {
  it('accepts one minute without native number-input underflow', () => {
    render(<AssignmentTimelineDemo />);
    setDate(screen.getByLabelText('Ngày'), '2026-11-02');
    const hours = screen.getByLabelText('Giờ') as HTMLInputElement;
    fireEvent.change(hours, { target: { value: String(1 / 60) } });
    expect(hours.checkValidity()).toBe(true);
    fireEvent.click(screen.getByText('Thêm phân bổ', { selector: 'button' }));
    fireEvent.click(screen.getByText('Xem trước', { selector: 'button' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 phút');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }, 15000);

  it('shows the synthetic-only boundary and previews, undoes and resets in-memory allocations', () => {
    render(<AssignmentTimelineDemo />);
    expect(screen.getByRole('heading', { name: 'Resource timeline' })).toBeTruthy();
    expect(screen.getByText(/Không lưu, không gọi server hoặc Maximo/)).toBeTruthy();
    const person = 'EI-TECH-1';
    const workingDate = monthDays('2026-11').find(d => availability(person, d) === 'working')!;
    setDate(screen.getByLabelText('Ngày'), workingDate);
    fireEvent.change(screen.getByLabelText('Giờ'), { target: { value: '1.15' } });
    fireEvent.click(screen.getByText('Thêm phân bổ', { selector: 'button' }));
    fireEvent.click(screen.getByText('Xem trước', { selector: 'button' }));
    expect(screen.getByRole('status').textContent).toContain('14,15h');
    expect(screen.getByText('Hoàn tác', { selector: 'button' })).toBeEnabled();
    fireEvent.click(screen.getByText('Hoàn tác', { selector: 'button' }));
    expect(screen.getByRole('status').textContent).toContain('13h');
    fireEvent.click(screen.getByLabelText(/^Sửa WO-41001, offshore-test, BD-1/));
    expect(screen.getByText('Lưu thay đổi', { selector: 'button' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Đặt lại PoC', { selector: 'button' }));
    expect(screen.queryByText('Lưu thay đổi', { selector: 'button' })).not.toBeInTheDocument();
    expect(screen.getByText('Thêm phân bổ', { selector: 'button' })).toBeInTheDocument();
    expect(initialRoster.allocations).toHaveLength(3);
  }, 15000);
});
