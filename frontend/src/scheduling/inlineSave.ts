import { BatchError, openBatch, prepareBatch, saveBatch, saveDraft, type BatchRow, type Changes, type Detail, type DraftNotice, type Scope } from '../api/drafts';
import type { PlanningMarker, WorkOrder } from '../api/workOrders';
import { deriveChanges, hasChanges, problemOf, type Staged } from './inlineEdit';
import { rowKey } from './presentation';

export type InlineRow = { order: WorkOrder; marker?: PlanningMarker; staged: Staged };
export type InlineResult = { notices: DraftNotice[]; failed: Record<string, string> };

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Không lưu được.';
const MAX_GROUP = 200;

/**
 * Saves cell edits as drafts without ever touching Maximo: rows that already have a draft update that draft
 * (a group draft is rewritten as a whole), rows without one become a new draft (a group when there are several).
 */
export async function saveInlineEdits(scope: Scope, timeZone: string, rows: InlineRow[], signal: AbortSignal): Promise<InlineResult> {
  const notices: DraftNotice[] = []; const failed: Record<string, string> = {};
  if (!rows.length) return { notices, failed };
  const prepared = await prepareBatch(scope, rows.map(({ order }) => ({ site_id: order.siteid, workorder_id: order.workorderid })), signal);
  const fresh = new Map(prepared.map((detail) => [rowKey(detail.item), detail]));
  const check = (detail: Detail, changes: Changes): string => {
    if (!hasChanges(changes)) return 'Không còn khác Maximo; không có gì để lưu.';
    return problemOf(detail.item, changes, detail.allowed_pics);
  };
  const singles: InlineRow[] = []; const created: InlineRow[] = []; const groups = new Map<string, InlineRow[]>();
  for (const row of rows) {
    if (!row.marker) created.push(row);
    else if (row.marker.is_batch) groups.set(row.marker.draft_id, [...groups.get(row.marker.draft_id) ?? [], row]);
    else singles.push(row);
  }
  const identity = (order: WorkOrder) => ({ ...scope, site_id: order.siteid, workorder_id: order.workorderid });

  for (const row of singles) {
    const key = rowKey(row.order); const detail = fresh.get(key); const marker = row.marker!;
    if (!detail) { failed[key] = 'WO không còn khả dụng.'; continue; }
    const changes = deriveChanges(detail.item, marker.changes, row.staged, timeZone);
    const problem = check(detail, changes);
    if (problem) { failed[key] = problem; continue; }
    try {
      const saved = await saveDraft(identity(detail.item), changes, detail.baseline_token, crypto.randomUUID(),
        { draft_id: marker.draft_id, version: marker.version, state: 'draft' }, signal, marker.baseline_changed);
      notices.push({ ...saved, items: [{ ...detail, changes }] });
    } catch (cause) { failed[key] = message(cause); }
  }

  for (const [draftId, members] of groups) {
    try {
      const latest = await openBatch(draftId, scope, signal);
      const staged = new Map(members.map((row) => [rowKey(row.order), row]));
      let valid = true;
      const items: BatchRow[] = latest.items.map((item) => {
        const row = staged.get(rowKey(item.item));
        if (!row) return item;
        const changes = deriveChanges(item.item, item.changes, row.staged, timeZone);
        const problem = check(item, changes);
        if (problem) { failed[rowKey(item.item)] = problem; valid = false; }
        return { ...item, changes };
      });
      if (!valid) continue;
      const saved = await saveBatch(scope, items, crypto.randomUUID(), { draft_id: draftId, version: latest.version, state: 'draft' },
        signal, latest.items.some((item) => item.baseline_changed));
      notices.push({ ...saved, items });
    } catch (cause) {
      const issues = cause instanceof BatchError ? new Map(cause.issues.map((issue) => [JSON.stringify([issue.site_id, issue.workorder_id]), issue.code])) : null;
      for (const row of members) failed[rowKey(row.order)] = issues?.get(rowKey(row.order)) ? 'WO hoặc nháp vừa đổi; mở lại để đối chiếu.' : message(cause);
    }
  }

  const items: BatchRow[] = [];
  for (const row of created) {
    const key = rowKey(row.order); const detail = fresh.get(key);
    if (!detail) { failed[key] = 'WO không còn khả dụng.'; continue; }
    const changes = deriveChanges(detail.item, {}, row.staged, timeZone);
    const problem = check(detail, changes);
    if (problem) failed[key] = problem; else items.push({ ...detail, changes });
  }
  for (let start = 0; start < items.length; start += MAX_GROUP) {
    const chunk = items.slice(start, start + MAX_GROUP);
    try {
      if (chunk.length === 1) {
        const [only] = chunk;
        const saved = await saveDraft(identity(only.item), only.changes, only.baseline_token, crypto.randomUUID(), null, signal);
        notices.push({ ...saved, items: chunk });
      } else {
        const saved = await saveBatch(scope, chunk, crypto.randomUUID(), null, signal);
        notices.push({ ...saved, items: chunk });
      }
    } catch (cause) {
      const issues = cause instanceof BatchError ? new Map(cause.issues.map((issue) => [JSON.stringify([issue.site_id, issue.workorder_id]), issue.code])) : null;
      for (const item of chunk) failed[rowKey(item.item)] = issues?.get(rowKey(item.item)) ? 'WO đã thay đổi; làm mới rồi thử lại.' : message(cause);
    }
  }
  return { notices, failed };
}
