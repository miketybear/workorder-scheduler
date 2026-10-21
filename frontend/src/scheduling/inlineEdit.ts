import type { Baseline, Changes } from '../api/drafts';
import type { WorkOrder } from '../api/workOrders';
import { equalField, scheduledChange, validateChanges } from './editing';

/** Values typed straight into the table cells; Scheduled Finish is always derived, never staged. */
export type Staged = { schedstart?: string; assignedtechname?: string; estdur?: string };
export type StagedField = keyof Staged;

export const baselineOf = (order: WorkOrder): Baseline => ({
  schedstart: order.schedstart, schedfinish: order.schedfinish, assignedtechname: order.assignedtechname, estdur: order.estdur,
  targstartdate: order.targstartdate, targcompdate: order.targcompdate, worktype: order.worktype,
});

/** The draft's changes with the staged cell edits applied on top; the finish is recomputed on the offshore shift. */
export function deriveChanges(order: WorkOrder, draft: Changes, staged: Staged, timeZone: string): Changes {
  const baseline = baselineOf(order);
  let changes: Changes = { ...draft };
  if (staged.estdur !== undefined) changes = scheduledChange(changes, baseline, 'estdur', staged.estdur, timeZone);
  if (staged.schedstart !== undefined) changes = scheduledChange(changes, baseline, 'schedstart', staged.schedstart, timeZone);
  if (staged.assignedtechname !== undefined) changes = scheduledChange(changes, baseline, 'assignedtechname', staged.assignedtechname, timeZone);
  return changes;
}

export const hasChanges = (changes: Changes): boolean =>
  (['schedstart', 'schedfinish', 'assignedtechname', 'estdur', 'targstartdate', 'targcompdate'] as const).some((field) => changes[field] !== undefined);

/** What the row shows once the draft and the staged edits are applied. */
export function shown(order: WorkOrder, draft: Changes, staged: Staged, timeZone: string) {
  const changes = deriveChanges(order, draft, staged, timeZone);
  return {
    schedstart: changes.schedstart ?? order.schedstart, schedfinish: changes.schedfinish ?? order.schedfinish,
    assignedtechname: changes.assignedtechname ?? order.assignedtechname, estdur: changes.estdur ?? order.estdur, changes,
  };
}

/** Problem that would stop this row from being saved, or '' when it is fine. */
export function problemOf(order: WorkOrder, changes: Changes, pics: string[]): string {
  return validateChanges(baselineOf(order), changes, pics);
}

/** Stage `value`, or un-stage the field when it equals what the row already shows. */
export function stage(previous: Record<string, Staged>, key: string, field: StagedField, value: string, current: string | null): Record<string, Staged> {
  const row: Staged = { ...previous[key] };
  if (value === '' || equalField(field, value, current)) delete row[field]; else row[field] = value;
  const next = { ...previous };
  if (Object.keys(row).length) next[key] = row; else delete next[key];
  return next;
}
