import { fireEvent, within } from '@testing-library/react';

// A date-time field is a typed "dd/mm/yyyy hh:mm" input (plus a calendar popup); a time-only field is two selects.
// These helpers read and write date-times as the datetime-local string "YYYY-MM-DDTHH:mm" ("" to clear).
const toWall = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : '';
};

export function setDateTime(group: HTMLElement, value: string): void {
  const field = within(group).getByLabelText(/\(nhập\)$/);
  fireEvent.change(field, { target: { value: toWall(value) } });
  fireEvent.blur(field);
}

export function getDateTime(group: HTMLElement): string {
  const text = (within(group).getByLabelText(/\(nhập\)$/) as HTMLInputElement).value;
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}` : '';
}

/** The first interactive control of a date-time (typed field) or time (hour select) group; use it to assert disabled state. */
export function groupControl(group: HTMLElement): HTMLElement {
  const parts = within(group);
  return parts.queryByLabelText(/\(nhập\)$/) ?? parts.getByLabelText(/\(giờ\)$/);
}

// Date-only fields are typed "dd/mm/yyyy"; month fields "mm/yyyy". Values are the native "YYYY-MM-DD" / "YYYY-MM" strings.
export function setDate(group: HTMLElement, value: string): void {
  const field = within(group).getByLabelText(/\(nhập\)$/);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  fireEvent.change(field, { target: { value: match ? `${match[3]}/${match[2]}/${match[1]}` : '' } });
  fireEvent.blur(field);
}

export function getDate(group: HTMLElement): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((within(group).getByLabelText(/\(nhập\)$/) as HTMLInputElement).value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

export function setMonthValue(group: HTMLElement, value: string): void {
  const field = within(group).getByLabelText(/\(nhập\)$/);
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  fireEvent.change(field, { target: { value: match ? `${match[2]}/${match[1]}` : '' } });
  fireEvent.blur(field);
}

export function getMonthValue(group: HTMLElement): string {
  const match = /^(\d{2})\/(\d{4})$/.exec((within(group).getByLabelText(/\(nhập\)$/) as HTMLInputElement).value);
  return match ? `${match[2]}-${match[1]}` : '';
}
