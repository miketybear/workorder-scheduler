import { fireEvent, within } from '@testing-library/react';

// Date-time fields are a group of a date input and 24 h hour/minute selects; these helpers read and write them as
// the datetime-local string "YYYY-MM-DDTHH:mm" (or "" when empty / to clear).
export function setDateTime(group: HTMLElement, value: string): void {
  const parts = within(group);
  const [date, time = ''] = value.split('T');
  fireEvent.change(parts.getByLabelText(/\(ngày\)$/), { target: { value: date } });
  if (!date) return;
  const [hour, minute] = time.split(':');
  if (hour !== undefined) fireEvent.change(parts.getByLabelText(/\(giờ\)$/), { target: { value: hour } });
  if (minute !== undefined) fireEvent.change(parts.getByLabelText(/\(phút\)$/), { target: { value: minute } });
}

export function getDateTime(group: HTMLElement): string {
  const parts = within(group);
  const date = (parts.getByLabelText(/\(ngày\)$/) as HTMLInputElement).value;
  const hour = (parts.getByLabelText(/\(giờ\)$/) as HTMLSelectElement).value;
  const minute = (parts.getByLabelText(/\(phút\)$/) as HTMLSelectElement).value;
  return date ? `${date}T${hour}:${minute}` : '';
}

/** The first interactive control of a date-time (date) or time (hour) group; use it to assert disabled state. */
export function groupControl(group: HTMLElement): HTMLElement {
  const parts = within(group);
  return parts.queryByLabelText(/\(ngày\)$/) ?? parts.getByLabelText(/\(giờ\)$/);
}
