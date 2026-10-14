import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RotaStagingPreview } from './RotaStagingPreview';

describe('RotaStagingPreview', () => {
  it('blocks unresolved mapping, resolves it explicitly, and records a simulated revision with mappings', () => {
    render(<RotaStagingPreview />);
    const activate = screen.getByRole('button', { name: 'Xác nhận và kích hoạt (mô phỏng)' }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('LABOR dòng 18'), { target: { value: 'onshore-test/BDPOC/SYN-EI-02' } });
    expect(activate.disabled).toBe(true);
    const risk = screen.getByLabelText(/Tôi đã xem thay đổi roster/) as HTMLInputElement;
    fireEvent.click(risk);
    expect(activate.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('LABOR dòng 18'), { target: { value: 'offshore-test/BDPOC/SYN-EI-03' } });
    expect(risk.checked).toBe(false);
    expect(activate.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('LABOR dòng 18'), { target: { value: 'onshore-test/BDPOC/SYN-EI-02' } });
    fireEvent.click(risk);
    expect(activate.disabled).toBe(false);
    fireEvent.click(activate);
    expect(screen.getByRole('status')).toHaveTextContent(/revision mô phỏng/);
    expect(screen.getByLabelText('LABOR dòng 18')).toHaveValue('onshore-test/BDPOC/SYN-EI-02');
    expect(screen.getByRole('status')).toHaveTextContent(/5 mapping LABOR/);
  });

  it('renders supported working and off-day codes using their model capacity', () => {
    render(<RotaStagingPreview />);
    expect(screen.getAllByText(/2026-11-01: 10,5 giờ/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2026-11-02: nghỉ \(AL\) · 0 giờ/)).toBeInTheDocument();
  });

  it('excludes unrelated labor, blocks invalid source cells, and cancels the staged preview', () => {
    render(<RotaStagingPreview />);
    expect(screen.getByText(/Ngoai Rota/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /SYN-OLD-01/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Mẫu kiểm tra'), { target: { value: 'invalid' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/NH4/);
    expect((screen.getByRole('button', { name: 'Xác nhận và kích hoạt (mô phỏng)' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy import' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Đã hủy import/);
    expect(screen.queryByRole('button', { name: 'Xác nhận và kích hoạt (mô phỏng)' })).not.toBeInTheDocument();
  });

  it('reloads a corrected sample and clears mappings from the previous preview', () => {
    render(<RotaStagingPreview />);
    fireEvent.change(screen.getByLabelText('Mẫu kiểm tra'), { target: { value: 'unmatched' } });
    expect(screen.getAllByText(/Vu Duc Long/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Xác nhận và kích hoạt (mô phỏng)' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Thử upload lại (mẫu)' }));
    expect(screen.getByText(/rota-demo-r04.xlsx/)).toBeInTheDocument();
    expect(screen.getByLabelText('LABOR dòng 22')).toHaveValue('onshore-test/BDPOC/SYN-RES-02');
    expect(screen.getByRole('status')).toHaveTextContent(/Mapping được tính lại từ đầu/);
  });
});
