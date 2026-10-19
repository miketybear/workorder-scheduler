import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Assignment } from '../api/assignments';
import { AssignmentCard } from './AssignmentCard';
import { restoreFocus } from './focusRestore';

const item = { id: 'a-1', pool_id: 'pool', connection_id: 'conn', site_id: 'SITE', workorder_id: 'wo-1', discipline: 'E&I', person_id: 'p-1',
  date: '2026-10-05', minutes: 120, version: 1, state: 'reserved' } as Assignment;
const handlers = { onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn(), onClick: vi.fn() };
const card = () => <AssignmentCard item={item} taskLabel="T10 · Pump" wonum="WO-1" personName="Nguyen A" date="2026-10-05" hours="2" {...handlers} />;

it('shows the tooltip on keyboard focus but not when a closing dialog restores focus to the card', () => {
  render(card());
  const button = screen.getByRole('button');
  act(() => button.focus());
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  act(() => button.blur());
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  act(() => restoreFocus(button));
  expect(button).toHaveFocus();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('can show the tooltip again by keyboard after a restored focus', () => {
  render(card());
  const button = screen.getByRole('button');
  act(() => restoreFocus(button));
  act(() => button.blur());
  act(() => button.focus());
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
});
