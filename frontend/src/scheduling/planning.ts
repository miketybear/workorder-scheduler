import type { PlanningMarker, WorkOrder } from '../api/workOrders';
import type { DraftNotice } from '../api/drafts';
import { rowKey } from './presentation';

export function chosenPlan(row: WorkOrder, choice?: string): PlanningMarker | undefined {
  return choice ? row.drafts?.find((item) => item.draft_id === choice) : row.drafts?.length === 1 ? row.drafts[0] : undefined;
}

export function effectiveOrder(row: WorkOrder, choice?: string): WorkOrder {
  const plan = chosenPlan(row, choice);
  if (!plan || plan.baseline_changed) return row;
  const fields = Object.fromEntries(Object.entries(plan.changes).filter(([key]) => key !== 'change_target'));
  return { ...row, ...fields };
}

export function updatePlans(rows: WorkOrder[], notice: DraftNotice): WorkOrder[] {
  const members = new Map(notice.items?.map((item) => [rowKey(item.item), item]) ?? []);
  return rows.map((row) => {
    const remaining = row.drafts?.filter((item) => item.draft_id !== notice.draft_id ||
      (notice.items === null ? item.version !== notice.version : false)) ?? [];
    const previous = row.drafts?.find((item) => item.draft_id === notice.draft_id);
    const member = members.get(rowKey(row));
    return { ...member?.item ?? row, drafts: member ? [...remaining, { draft_id: notice.draft_id, version: notice.version,
      is_batch: (notice.items?.length ?? 0) > 1, updated_at: notice.updated_at ?? previous?.updated_at ?? new Date().toISOString(), changes: member.changes,
      baseline_changed: member.baseline_changed ?? false }] : remaining };
  });
}
