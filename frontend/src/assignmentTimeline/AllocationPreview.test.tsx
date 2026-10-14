import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AllocationPreview } from './AllocationPreview';
import { initialRoster } from './fixtures';

describe('allocation before/after preview', () => {
  it('shows a move across months even when labor hours stay the same', () => {
    const current = { ...initialRoster, allocations: initialRoster.allocations.map(item =>
      item.id === 'seed-1' ? { ...item, date: '2026-12-02' } : item) };
    render(<AllocationPreview baseline={initialRoster} current={current} />);
    expect(screen.getByText(/1 thay đổi/)).toBeInTheDocument();
    expect(screen.getByText(/Trước:.*2026-11-02.*360 phút/)).toBeInTheDocument();
    expect(screen.getByText(/Sau:.*2026-12-02.*360 phút/)).toBeInTheDocument();
    expect(screen.getByText(/Sau:/)).toHaveTextContent('offshore-test / BD-1');
  });
});
