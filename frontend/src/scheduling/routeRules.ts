import type { PreviewItem, RouteItemState, RouteResultItem } from '../api/workflowRoute';
import type { WorkOrder } from '../api/workOrders';

/** Statuses from which BD_WO accepts the "Route to Tech PIC" choice (mirrors the server rule). */
export const ROUTABLE_STATUSES: readonly string[] = ['APPR', 'WSCHED', 'SCHED', 'WMAT', 'WPCOND', 'CPLAN', 'WMATL'];
export const MAX_ROUTE_BATCH = 20;

/** What the table already knows without asking the server; null means the server must decide. */
export function localRouteCode(row: WorkOrder): string | null {
  if (row.drafts?.length) return 'not_synced';
  if (!ROUTABLE_STATUSES.includes(row.status)) return 'status_not_routable';
  if (!row.schedstart || !row.schedfinish) return 'missing_schedule';
  if (!row.assignedto) return 'missing_assignee';
  return null;
}

/** Changes whenever a field that decides readiness changes, so a cached answer is never reused for another state. */
export const routeFingerprint = (row: WorkOrder): string =>
  JSON.stringify([row.status, row.schedstart, row.schedfinish, row.assignedto, row.drafts?.length ?? 0]);

export type RouteInfo = { fingerprint: string; ready: boolean; code: string; assigned_to: string | null; supervisor: PreviewItem['supervisor'] };

export const infoFromPreview = (row: WorkOrder, item: PreviewItem): RouteInfo =>
  ({ fingerprint: routeFingerprint(row), ready: item.ready, code: item.code, assigned_to: item.assigned_to, supervisor: item.supervisor });

export const infoFromLocal = (row: WorkOrder, code: string): RouteInfo =>
  ({ fingerprint: routeFingerprint(row), ready: false, code, assigned_to: null, supervisor: null });

/** Short reason shown under a greyed Route button. */
export const REASON_TEXT: Record<string, string> = {
  ready: 'Sẵn sàng route',
  out_of_scope: 'Không thuộc phạm vi của bạn',
  not_synced: 'Còn nháp chưa gửi lên Maximo',
  upload_pending: 'Đang có lần upload chưa đối soát — mở Gửi WO để kiểm tra kết quả',
  supervisor_missing: 'Thiếu Supervisor (SUPNAME) và bạn không thuộc ALLSUPN',
  is_child: 'WO con, không route',
  status_not_routable: 'Status chưa route được',
  missing_schedule: 'Thiếu lịch bắt đầu/kết thúc',
  missing_assignee: 'Thiếu PIC hoặc ngày giao',
  no_workflow: 'WO chưa có workflow đang chờ',
  no_active_assignment: 'Không có việc chờ của tài khoản route',
  multiple_assignments: 'Nhiều việc đang chờ, cần kiểm tra tay',
  already_routed: 'Đã route',
  contract_changed: 'Workflow Maximo đã đổi, đang khóa route',
  route_in_progress: 'Đang có lần route khác cho WO này',
  authorization_changed: 'Quyền đã thay đổi',
  checking: 'Đang kiểm tra…',
  check_failed: 'Chưa kiểm tra được, thử lại sau',
};

/** Reasons that are not a plain "not yet": someone has to look (amber dot instead of grey). */
export const ATTENTION_CODES: ReadonlySet<string> = new Set(['contract_changed', 'check_failed', 'multiple_assignments', 'supervisor_missing', 'route_in_progress', 'upload_pending']);

export const reasonText = (code: string): string => REASON_TEXT[code] ?? 'Chưa route được';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** Outcome labels for the result list; `stranded` must stay loud, it needs a Maximo admin. */
export const STATE_TEXT: Record<RouteItemState, { label: string; tone: Tone }> = {
  confirmed: { label: 'Đã route', tone: 'good' },
  rejected: { label: 'Chưa route (không đổi)', tone: 'neutral' },
  failed: { label: 'Chưa route (không đổi)', tone: 'neutral' },
  stranded: { label: 'Mất việc, cần admin Maximo', tone: 'bad' },
  unknown: { label: 'Chưa rõ kết quả', tone: 'warn' },
  pending: { label: 'Đang xử lý', tone: 'warn' },
  sending: { label: 'Đang gửi', tone: 'warn' },
  not_attempted: { label: 'Chưa thử', tone: 'neutral' },
};

const DETAIL_TEXT: Record<string, string> = {
  complete_rejected: 'Maximo từ chối hoàn thành việc.',
  route_session_expired: 'Maximo từ chối phiên tài khoản route; nhập lại mật khẩu.',
  route_session_required: 'Chưa có phiên tài khoản route.',
  read_failed: 'Không đọc lại được WO.',
  audit_unavailable: 'Không ghi được nhật ký; chưa gửi gì.',
  supname_write_rejected: 'Maximo từ chối ghi Supervisor (SUPNAME).',
  supname_write_unknown: 'Chưa rõ việc ghi Supervisor; kiểm tra lại WO.',
  supname_conflict: 'WO vừa đổi, không ghi được Supervisor.',
  supname_unwritable: 'Không ghi được Supervisor cho WO này.',
  supname_not_confirmed: 'Chưa xác nhận được Supervisor sau khi ghi.',
  assignment_changed: 'Việc workflow vừa thay đổi.',
  abandoned_pending: 'Lần route trước bị bỏ dở.',
  stranded_no_assignment: 'Maximo đã hoàn thành việc cũ nhưng không tạo việc mới cho PIC.',
  option_mismatch: 'Lựa chọn route không như kỳ vọng.',
  choose_rejected: 'Maximo từ chối lựa chọn route.',
  choice_location_invalid: 'Địa chỉ lựa chọn không hợp lệ.',
  complete_unconfirmed: 'Chưa xác nhận được việc đã hoàn thành.',
  choose_unconfirmed: 'Chưa xác nhận được lựa chọn route.',
  readback_unavailable: 'Chưa đọc lại được trạng thái workflow.',
  unexpected_assignment: 'Việc workflow ở trạng thái bất thường.',
  stranded: 'Dừng vì một WO trước đó mất việc.',
  unknown: 'Dừng vì một WO trước đó chưa rõ kết quả.',
};

export function resultDetail(item: RouteResultItem): string {
  if (item.state === 'confirmed') return item.assigned_to ? `PIC ${item.assigned_to}` : '';
  const code = item.code ?? '';
  return DETAIL_TEXT[code] ?? (code && code in REASON_TEXT ? reasonText(code) : code.startsWith('previous_work_order_') ? 'Dừng vì WO trước đó.' : '');
}

/** Replaces the data of routed rows with what Maximo now says, keeping the app-side markers (drafts, allocation). */
export function mergeFreshRows(rows: WorkOrder[], fresh: WorkOrder[]): WorkOrder[] {
  const byKey = new Map(fresh.map((row) => [JSON.stringify([row.siteid, row.workorderid]), row]));
  return rows.map((row) => {
    const updated = byKey.get(JSON.stringify([row.siteid, row.workorderid]));
    return updated ? { ...row, ...updated, drafts: row.drafts, allocation_summary: row.allocation_summary } : row;
  });
}

/** The single bucket a row falls in for the summary chips and the filter. */
export function routeCategory(outcome: RouteResultItem | undefined, info: RouteInfo | null): string {
  if (outcome?.state === 'confirmed') return 'done';
  if (outcome?.state === 'stranded') return 'stranded';
  if (outcome?.state === 'unknown') return 'unknown';
  if (!info) return 'checking';
  if (info.code === 'already_routed') return 'done';
  return info.ready ? 'ready' : info.code;
}

const CHIP_TEXT: Record<string, string> = {
  ready: 'Sẵn sàng route', done: 'Đã route', stranded: 'Mất việc', unknown: 'Chưa rõ kết quả', checking: 'Đang kiểm tra',
  not_synced: 'Còn nháp', missing_schedule: 'Thiếu lịch', missing_assignee: 'Thiếu PIC/ngày giao', status_not_routable: 'Status chưa route được',
  upload_pending: 'Upload chưa xong',
  no_active_assignment: 'Không có việc chờ', no_workflow: 'Chưa có workflow', supervisor_missing: 'Thiếu Supervisor', is_child: 'WO con',
};
export const chipText = (category: string): string => CHIP_TEXT[category] ?? reasonText(category);

/** Chips in reading order: what can be acted on first, then what is done, then the reasons by size. */
/** Workflow states in Maximo the planner cannot act on from this app; the row's Action reason still explains them, but they get no chip. */
const UNCHIPPED: ReadonlySet<string> = new Set(['no_active_assignment', 'no_workflow', 'is_child']);

export function routeChips(categories: string[]): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const category of categories) if (!UNCHIPPED.has(category)) counts.set(category, (counts.get(category) ?? 0) + 1);
  const rank = (category: string) => ['ready', 'upload_pending', 'contract_changed', 'check_failed', 'multiple_assignments', 'supervisor_missing', 'route_in_progress', 'done', 'stranded', 'unknown', 'checking'].indexOf(category);
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => {
    const ra = rank(a.category); const rb = rank(b.category);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return b.count - a.count || chipText(a.category).localeCompare(chipText(b.category), 'vi');
  });
}

/** True when every WO ended in a state that needs no attention (never claim success while one is left). */
export const allConfirmed = (items: RouteResultItem[]): boolean => items.length > 0 && items.every((item) => item.state === 'confirmed');

export const SUMMARY_NEEDS_ATTENTION = (items: RouteResultItem[]): boolean => items.some((item) => item.state === 'stranded' || item.state === 'unknown');
