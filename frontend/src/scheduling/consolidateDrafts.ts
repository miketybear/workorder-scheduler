import { deleteDraft, editableFields, openBatch, prepareBatch, saveBatch, type BatchRow, type Changes, type DraftNotice, type Scope } from '../api/drafts';
import type { PlanningMarker, WorkOrder } from '../api/workOrders';
import { equalField } from './editing';
import { rowKey } from './presentation';

export const MAX_SEND = 200;
export type Consolidated = { draftId: string; dropped: string[]; warnings: string[] };
type Entry = { key: string; site_id: string; workorder_id: string; changes: Changes; updatedAt: number };
type Involved = { draft_id: string; version: number; is_batch: boolean; updatedAt: number };

const stamp = (marker: PlanningMarker) => Date.parse(marker.updated_at) || 0;
const identity = (key: string) => { const [site_id, workorder_id] = JSON.parse(key) as [string, string]; return { site_id, workorder_id }; };

/** Keep only changes that still differ from Maximo and use a PIC that is still allowed; null when nothing is left. */
function stillNeeded(row: Pick<BatchRow, 'baseline' | 'allowed_pics'>, changes: Changes): Changes | null {
  const kept: Changes = {};
  for (const field of editableFields) {
    const value = changes[field];
    if (value === undefined || equalField(field, value, row.baseline[field])) continue;
    if (field === 'assignedto' && !row.allowed_pics.includes(value)) continue;
    kept[field] = value;
  }
  if (!editableFields.some((field) => kept[field] !== undefined)) return null;
  if (changes.change_target !== undefined && (kept.targstartdate !== undefined || kept.targcompdate !== undefined)) kept.change_target = changes.change_target;
  return kept;
}

/**
 * Turns every WO draft of the loaded table into ONE draft that can be sent. An existing draft that already is
 * exactly that set is reused untouched. Otherwise a new group is saved first and only then are the merged drafts
 * deleted, so a failure can never lose a plan. Each draft change is reported through onNotice.
 */
export async function consolidateDrafts(scope: Scope, rows: WorkOrder[], signal: AbortSignal,
  onNotice: (notice: DraftNotice) => void = () => {}): Promise<Consolidated> {
  const drafted = rows.filter((row) => row.drafts?.length);
  if (!drafted.length) throw new Error('Không có WO nào có nháp để gửi.');
  const involved = new Map<string, Involved>();
  for (const row of drafted) for (const marker of row.drafts ?? []) {
    const known = involved.get(marker.draft_id);
    involved.set(marker.draft_id, { draft_id: marker.draft_id, version: Math.max(known?.version ?? 0, marker.version),
      is_batch: marker.is_batch, updatedAt: Math.max(known?.updatedAt ?? 0, stamp(marker)) });
  }
  const wanted = new Set(drafted.map(rowKey));

  const entries = new Map<string, Entry>();
  const take = (draft: Involved, key: string, changes: Changes) => {
    const previous = entries.get(key);
    if (!previous || draft.updatedAt >= previous.updatedAt) entries.set(key, { key, ...identity(key), changes, updatedAt: draft.updatedAt });
  };
  const versions = new Map<string, number>();
  // Oldest draft first so that, for a WO that sits in several drafts, the latest one wins.
  for (const draft of [...involved.values()].sort((a, b) => a.updatedAt - b.updatedAt)) {
    versions.set(draft.draft_id, draft.version);
    if (draft.is_batch) {
      const opened = await openBatch(draft.draft_id, scope, signal);
      versions.set(draft.draft_id, opened.version);
      if (involved.size === 1 && opened.items.length === wanted.size && opened.items.every((item) => wanted.has(rowKey(item.item)))) {
        return { draftId: draft.draft_id, dropped: [], warnings: [] };
      }
      // Every member is kept, also those outside the loaded table, so nothing is silently lost.
      opened.items.forEach((item) => take(draft, rowKey(item.item), item.changes));
    } else {
      if (involved.size === 1 && wanted.size === 1) return { draftId: draft.draft_id, dropped: [], warnings: [] };
      for (const row of drafted) {
        const marker = row.drafts?.find((item) => item.draft_id === draft.draft_id);
        if (marker) take(draft, rowKey(row), marker.changes);
      }
    }
  }
  if (entries.size > MAX_SEND) {
    throw new Error(`Có ${entries.size} WO có nháp, nhiều hơn giới hạn ${MAX_SEND} WO cho một lần gửi. Hãy thu hẹp danh sách bằng bộ lọc (ví dụ khoảng ngày hẹp hơn) rồi gửi từng phần.`);
  }

  const list = [...entries.values()];
  const fresh = await prepareBatch(scope, list.map(({ site_id, workorder_id }) => ({ site_id, workorder_id })), signal);
  const items: BatchRow[] = []; const dropped: string[] = [];
  list.forEach((entry, index) => {
    const detail = fresh[index];
    const changes = stillNeeded(detail, entry.changes);
    if (changes) items.push({ ...detail, changes }); else dropped.push(detail.item.wonum);
  });
  if (!items.length) throw new Error('Mọi thay đổi trong nháp đã trùng Maximo; không còn gì để gửi. Các nháp cũ được giữ nguyên.');

  const saved = await saveBatch(scope, items, crypto.randomUUID(), null, signal);
  onNotice({ ...saved, items });

  const warnings: string[] = [];
  for (const draft of involved.values()) {
    try {
      const gone = { draft_id: draft.draft_id, version: versions.get(draft.draft_id) ?? draft.version, state: 'draft' as const };
      await deleteDraft(gone, signal);
      onNotice({ ...gone, items: null });
    } catch (cause) {
      if (signal.aborted) throw cause;
      warnings.push(`Chưa xóa được một nháp cũ đã gộp (${cause instanceof Error ? cause.message : 'lỗi không rõ'}). Có thể còn nháp trùng; kiểm tra lại bảng.`);
    }
  }
  return { draftId: saved.draft_id, dropped, warnings };
}
