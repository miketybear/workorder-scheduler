import type { KeyboardEvent } from 'react';

/** The editable control a row offers in one column (text input or drop-down), skipping disabled ones. */
const CONTROL = 'input[type="text"]:not([disabled]), select:not([disabled])';

/**
 * Spreadsheet-style row navigation inside the WO table: Enter / Shift+Enter, and ArrowDown / ArrowUp in text cells,
 * move focus to the same column of the next / previous row that has an editable control. Drop-downs keep ArrowUp/Down
 * for choosing an option. Returns true when the key was used.
 */
export function moveBetweenRows(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const isSelect = target instanceof HTMLSelectElement;
  if (!(isSelect || target instanceof HTMLInputElement) || target.closest('[role="dialog"]')) return false;
  const cell = target.closest<HTMLElement>('td[data-nav]');
  if (!cell) return false;
  let step = 0;
  if (event.key === 'Enter') step = event.shiftKey ? -1 : 1;
  else if (!isSelect && !event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) step = event.key === 'ArrowDown' ? 1 : -1;
  if (!step) return false;
  for (let row = cell.parentElement?.[step > 0 ? 'nextElementSibling' : 'previousElementSibling']; row; row = row[step > 0 ? 'nextElementSibling' : 'previousElementSibling']) {
    const next = row.querySelector<HTMLInputElement | HTMLSelectElement>(`td[data-nav="${cell.dataset.nav}"] :is(${CONTROL})`);
    if (!next) continue;
    event.preventDefault();
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
    next.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  return false;
}
