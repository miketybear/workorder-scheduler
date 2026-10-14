import { config } from '../config';
import { isAwareDate } from './dates';
import type { Changes } from './drafts';

export type PlanningMarker = { draft_id: string; version: number; is_batch: boolean; updated_at: string;
  changes: Changes; baseline_changed: boolean };
export type AllocationSummary = { state:'unverified'|'unallocated'|'partial'|'completed'; remaining_minutes:number|null; remaining_tasks:number|null; total_tasks:number|null; verified_at:string|null };

export const columns = [
  ['wolo10', '% Complete'], ['bdpocdiscipline', 'Discipline'], ['wonum', 'Work Order'],
  ['description', 'Description'], ['worktype', 'Work Type'], ['location', 'Tag Name'],
  ['systemid', 'System ID'], ['schedstart', 'Scheduled Start'], ['schedfinish', 'Scheduled Finish'],
  ['actstart', 'Actual Start'], ['actfinish', 'Actual Finish'], ['status', 'Status'],
  ['wopriority_description', 'Priority'], ['lead', 'Onshore PIC'], ['assignedtechname', 'Assigned PIC'],
  ['estdur', 'Est. Duration'], ['targstartdate', 'Target Start'], ['targcompdate', 'Target Finish'],
  ['workorderid', 'WOID'],
] as const;
type Field = typeof columns[number][0];
export type WorkOrder = Record<Field, string | null> & { siteid: string; wonum: string; workorderid: string; worktype: string; status: string; targcompdate: string; wopriority: number | null; drafts?: PlanningMarker[]; allocation_summary?:AllocationSummary };
export type WorkOrderFilter = { connection_id: string; discipline: string; target_from: string; target_before: string };
export type WorkOrderPageFilter = WorkOrderFilter & { view:'all'|'backlog'|'completed'; search:string; cursor?:string; refresh?:boolean };
export type WorkOrderPage = { connection_id:string; discipline:string; count:number; items:WorkOrder[]; next_cursor:string|null; has_more:boolean; total_count:number; page_size:20; view:'all'|'backlog'|'completed'; search:string; filter_revision:string; snapshot_id:string; expires_at:string };

export class RetrievalError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function validateRange(start: string, end: string): void {
  const duration = Date.parse(end) - Date.parse(start);
  if (!isAwareDate(start) || !isAwareDate(end) || duration <= 0 || duration > 366 * 86400000) {
    throw new Error('Nhập ngày giờ ISO có múi giờ; mốc cuối phải sau mốc đầu, tối đa 366 ngày.');
  }
}

export async function retrieveWorkOrders(filter: WorkOrderFilter, signal: AbortSignal): Promise<WorkOrder[]> {
  validateRange(filter.target_from, filter.target_before);
  const response = await fetch(`${config.apiBase}/work-orders?${new URLSearchParams(filter)}`, {
    signal, credentials: 'same-origin', cache: 'no-store',
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
      404: 'Phạm vi không còn được cấp quyền. Hãy kiểm tra lại phiên đăng nhập.',
      422: 'Bộ lọc chưa hợp lệ. Kiểm tra khoảng ngày và múi giờ.',
      502: 'Không lấy được đầy đủ dữ liệu Maximo. Thử thu hẹp khoảng ngày hoặc liên hệ IT.',
      503: 'Kết nối dữ liệu chưa sẵn sàng hoặc chưa được cấu hình.',
      504: 'Yêu cầu xử lý quá thời gian. Thử thu hẹp khoảng ngày rồi tải lại.',
    };
    throw new RetrievalError(response.status, messages[response.status] ?? 'Không lấy được dữ liệu. Hãy thử lại.');
  }
  const body: unknown = await response.json();
  const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
  if (!object(body) || body.connection_id !== filter.connection_id || body.discipline !== filter.discipline ||
      !Array.isArray(body.items) || body.count !== body.items.length) throw new Error('Phản hồi dữ liệu không hợp lệ.');
  const keys = new Set<string>();
  return body.items.map((raw: unknown) => {
    const row = parseWorkOrder(raw, filter.discipline);
    const key = JSON.stringify([row.siteid, row.workorderid]);
    if (keys.has(key)) throw new Error('Phản hồi chứa WO trùng định danh.');
    keys.add(key);
    return row;
  });
}

export async function retrieveWorkOrderPage(filter:WorkOrderPageFilter,signal:AbortSignal):Promise<WorkOrderPage>{
  validateRange(filter.target_from,filter.target_before);
  if(!['all','backlog','completed'].includes(filter.view)||typeof filter.search!=='string'||filter.search.length>200||filter.cursor!==undefined&&(!filter.cursor||filter.cursor.length>4096)||filter.refresh!==undefined&&typeof filter.refresh!=='boolean'||filter.refresh&&filter.cursor)throw new Error('Bộ lọc trang Work Order không hợp lệ.');
  const query=new URLSearchParams({connection_id:filter.connection_id,discipline:filter.discipline,target_from:filter.target_from,target_before:filter.target_before,view:filter.view,search:filter.search});
  if(filter.cursor!==undefined)query.set('cursor',filter.cursor);
  if(filter.refresh)query.set('refresh','true');
  const response=await fetch(`${config.apiBase}/work-orders/page?${query}`,{signal,credentials:'same-origin',cache:'no-store'});
  if(!response.ok){
    const messages:Record<number,string>={401:'Phiên đã hết hạn. Vui lòng đăng nhập lại.',403:'Không có quyền xem danh sách Work Order.',404:'Phạm vi không còn được cấp quyền. Hãy kiểm tra lại phiên đăng nhập.',409:'Danh sách Work Order đã thay đổi. Đang tải lại trang đầu.',422:'Bộ lọc chưa hợp lệ. Kiểm tra khoảng ngày và múi giờ.',502:'Không lấy được đầy đủ dữ liệu Maximo. Thử thu hẹp khoảng ngày hoặc liên hệ IT.',503:'Kết nối dữ liệu chưa sẵn sàng hoặc chưa được cấu hình.',504:'Yêu cầu xử lý quá thời gian. Thử thu hẹp khoảng ngày rồi tải lại.'};
    throw new RetrievalError(response.status,messages[response.status]??'Không lấy được danh sách Work Order. Hãy thử lại.');
  }
  const body:unknown=await response.json();
  if(!isRecord(body)||body.connection_id!==filter.connection_id||body.discipline!==filter.discipline||body.view!==filter.view||body.search!==filter.search||
    !Array.isArray(body.items)||body.items.length>20||body.count!==body.items.length||body.page_size!==20||typeof body.has_more!=='boolean'||
    body.has_more&&body.items.length!==20||
    !(body.next_cursor===null||typeof body.next_cursor==='string'&&body.next_cursor.length>0&&body.next_cursor.length<=4096)||body.has_more!==(body.next_cursor!==null)||
    !(Number.isSafeInteger(body.total_count)&&Number(body.total_count)>=body.items.length)||typeof body.filter_revision!=='string'||!body.filter_revision||body.filter_revision.length>256||
    typeof body.snapshot_id!=='string'||!body.snapshot_id||body.snapshot_id.length>128||typeof body.expires_at!=='string'||!isAwareDate(body.expires_at))
    throw new Error('Phản hồi trang Work Order không hợp lệ.');
  const keys=new Set<string>();
  const items=body.items.map((raw:unknown)=>{const row=parseWorkOrder(raw,filter.discipline);const key=JSON.stringify([row.siteid,row.workorderid]);if(keys.has(key))throw new Error('Phản hồi chứa WO trùng định danh.');keys.add(key);return row;});
  return {...body,items} as WorkOrderPage;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseWorkOrder(raw: unknown, discipline: string): WorkOrder {
    if (!isRecord(raw) || typeof raw.siteid !== 'string' || !raw.siteid || raw.bdpocdiscipline !== discipline ||
        !columns.every(([field]) => raw[field] === null || typeof raw[field] === 'string') ||
        !['wonum', 'workorderid', 'worktype', 'status', 'targcompdate'].every((field) => typeof raw[field] === 'string' && raw[field]) ||
        !(raw.wopriority === null || (typeof raw.wopriority === 'number' && Number.isInteger(raw.wopriority)))) {
      throw new Error('Phản hồi WO không hợp lệ.');
    }
  let allocation_summary:AllocationSummary|undefined;
  if(raw.allocation_summary!==undefined){const summary=raw.allocation_summary;
    if(!isRecord(summary)||!['unverified','unallocated','partial','completed'].includes(String(summary.state))||!(summary.remaining_minutes===null||Number.isInteger(summary.remaining_minutes)&&Number(summary.remaining_minutes)>=0)||!(summary.remaining_tasks===null||Number.isInteger(summary.remaining_tasks)&&Number(summary.remaining_tasks)>=0)||!(summary.total_tasks===null||Number.isInteger(summary.total_tasks)&&Number(summary.total_tasks)>=0)||!(summary.verified_at===null||typeof summary.verified_at==='string')||summary.state==='completed'&&(summary.remaining_minutes!==0||summary.remaining_tasks!==0||summary.verified_at===null))throw new Error('Tổng hợp phân bổ WO không hợp lệ.');
    allocation_summary=summary as AllocationSummary;
  }
  return { ...raw, allocation_summary, drafts: parsePlanningMarkers(raw.drafts ?? []) } as WorkOrder;
}

export function effectiveAllocationSummary(order:WorkOrder,now=Date.now()):AllocationSummary {
  const summary=order.allocation_summary;
  if(!summary||summary.state==='unverified'||!summary.verified_at)return {state:'unverified',remaining_minutes:null,remaining_tasks:null,total_tasks:summary?.total_tasks??null,verified_at:null};
  const verifiedAt=Date.parse(summary.verified_at);
  if(!Number.isFinite(verifiedAt)||verifiedAt>now||now-verifiedAt>=5*60_000)return {state:'unverified',remaining_minutes:null,remaining_tasks:null,total_tasks:summary.total_tasks,verified_at:null};
  return summary;
}

export function parsePlanningMarkers(raw: unknown): PlanningMarker[] {
  if (!Array.isArray(raw)) throw new Error('Phản hồi kế hoạch không hợp lệ.');
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.draft_id !== 'string' || !item.draft_id || ids.has(item.draft_id) ||
      !Number.isInteger(item.version) || Number(item.version) < 1 || typeof item.is_batch !== 'boolean' ||
      typeof item.baseline_changed !== 'boolean' || typeof item.updated_at !== 'string' || !isAwareDate(item.updated_at) || !isRecord(item.changes) ||
      !Object.entries(item.changes).every(([key, value]) => key === 'change_target' ? typeof value === 'boolean' :
        ['schedstart', 'schedfinish', 'assignedtechname', 'estdur', 'targstartdate', 'targcompdate'].includes(key) && typeof value === 'string')) {
      throw new Error('Phản hồi kế hoạch không hợp lệ.');
    }
    ids.add(item.draft_id);
  }
  return raw as PlanningMarker[];
}
