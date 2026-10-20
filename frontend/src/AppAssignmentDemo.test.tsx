import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { getMonthValue, setMonthValue } from './testDateTime';

vi.mock('./scheduling/WorkOrders', () => ({ WorkOrders: () => null }));
vi.mock('./components/Settings', () => ({ Settings: () => <h1>Account settings</h1> }));
vi.mock('./components/Admin', () => ({ Admin: () => null, AdminLink: () => null }));
vi.mock('./components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('./auth/SessionPanel', () => ({ SessionPanel: () => null }));
vi.mock('./assignmentTimeline/fixtures', async importOriginal => {
  const actual=await importOriginal<typeof import('./assignmentTimeline/fixtures')>();
  // Routing persistence needs a small roster; the timeline suite exercises the full fixture.
  const people=actual.initialRoster.people.slice(0,2);
  const workOrders=actual.initialRoster.workOrders.slice(0,6);
  const allocations=actual.initialRoster.allocations.filter(item=>people.some(person=>person.id===item.personId)&&workOrders.some(order=>order.id===item.workOrderId));
  return {...actual,initialRoster:{people,workOrders,allocations}};
});

describe('assignment demo route', () => {
  it('retains the synthetic workspace when navigating to settings and back', () => {
    render(<MemoryRouter initialEntries={['/assignment-demo']}><App /></MemoryRouter>);
    const navigation=within(screen.getByText('Cài đặt', {selector:'a'}).closest('header')!);
    const timelineHeader=screen.getByText('Resource timeline', {selector:'h1'}).closest('header')!;
    const month = within(timelineHeader).getByLabelText('Tháng');
    setMonthValue(month, '2026-12');
    fireEvent.click(navigation.getByRole('link', { name: 'Cài đặt' }));
    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeInTheDocument();
    expect(screen.getByText('Resource timeline', {selector:'h1'})).not.toBeVisible();
    fireEvent.click(navigation.getByRole('link', { name: 'Timeline thử nghiệm' }));
    expect(screen.getByText('Resource timeline', {selector:'h1'})).toBeVisible();
    expect(month).toBeVisible();
    expect(getMonthValue(month)).toBe('2026-12');
  });

  it('retains the staged preview selection when navigating to settings and back', () => {
    render(<MemoryRouter initialEntries={['/rota-staging-demo']}><App /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Mẫu kiểm tra'), { target: { value: 'unmatched' } });
    fireEvent.click(screen.getByRole('link', { name: 'Cài đặt' }));
    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Preview import rota' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Preview rota' }));
    expect(screen.getByRole('heading', { name: 'Preview import rota' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mẫu kiểm tra')).toHaveValue('unmatched');
    expect(screen.getByRole('button', { name: 'Xác nhận và kích hoạt (mô phỏng)' })).toBeDisabled();
  });
});
