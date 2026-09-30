import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DemoScheduler } from './DemoScheduler';

describe('synthetic scheduling preview', () => {
  it('locks PM and CFT target fields', () => {
    render(<MemoryRouter><DemoScheduler /></MemoryRouter>);
    expect(screen.getByLabelText('DEMO-001 Target Finish')).toBeDisabled();
    expect(screen.getByLabelText('DEMO-003 Target Finish')).toBeDisabled();
    expect(screen.getByLabelText('DEMO-002 Target Finish')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('DEMO-002 Change Target?'));
    expect(screen.getByLabelText('DEMO-002 Target Finish')).toBeEnabled();
  });
  it('previews changes without enabling an upload and resets edits', () => {
    render(<MemoryRouter><DemoScheduler /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('DEMO-001 Scheduled Finish'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Xem thay đổi'));
    expect(screen.getByText(/2026-09-29 → 2026-10-01/)).toBeInTheDocument();
    expect(screen.getByText(/Upload Maximo/)).toBeDisabled();
    fireEvent.click(screen.getByText('Đặt lại'));
    expect(screen.getByLabelText('DEMO-001 Scheduled Finish')).toHaveValue('2026-09-29');
    expect(screen.queryByText('Thay đổi dự kiến')).not.toBeInTheDocument();
  });
  it('blocks a finish earlier than start', () => {
    render(<MemoryRouter><DemoScheduler /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('DEMO-001 Scheduled Finish'), { target: { value: '2026-09-01' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Xem thay đổi')).toBeDisabled();
  });
  it('previews PIC and duration changes only for selected work orders', () => {
    render(<MemoryRouter><DemoScheduler /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('DEMO-001 Assigned PIC'), { target: { value: 'DEMO-TECH-02' } });
    fireEvent.change(screen.getByLabelText('DEMO-002 Est. Duration'), { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('DEMO-001 Upload?'));
    fireEvent.click(screen.getByText('Xem thay đổi'));
    expect(screen.getByText(/Est. Duration: 6 → 10/)).toBeInTheDocument();
    expect(screen.queryByText(/Assigned PIC: DEMO-TECH-01 → DEMO-TECH-02/)).not.toBeInTheDocument();
  });
  it('disabling target intent restores original target values', () => {
    render(<MemoryRouter><DemoScheduler /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('DEMO-002 Change Target?'));
    fireEvent.change(screen.getByLabelText('DEMO-002 Target Start'), { target: { value: '2026-09-27' } });
    fireEvent.click(screen.getByLabelText('DEMO-002 Change Target?'));
    expect(screen.getByLabelText('DEMO-002 Target Start')).toHaveValue('2026-09-26');
    expect(screen.getByLabelText('DEMO-002 Target Start')).toBeDisabled();
    expect(screen.getByText('Xem thay đổi')).toBeDisabled();
  });
});
