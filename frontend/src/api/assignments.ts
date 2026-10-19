import { config } from '../config';
import { isRecord, RetrievalError } from './workOrders';

export type CapacityDay = { date: string; code: string; capacity_minutes: number; allocated_minutes: number; remaining_minutes: number; local_minutes?: number; external_minutes?: number; synced_minutes?: number; load_complete?: boolean };
export type PlanningSummary = { state: 'unverified'|'unallocated'|'partial'|'completed'; remaining_minutes:number|null; remaining_tasks:number|null; total_tasks:number|null; verified_at:string|null };
export type AffectedCapacityDay = CapacityDay & { pool_id:string; person_id:string; craft:string; laborcode:string };
export type ResourcePerson = { person_id: string; name: string; craft: string; role: string; laborcode: string; days: CapacityDay[] };
export type Assignment = { id: string; pool_id: string; connection_id: string; site_id: string; workorder_id: string; discipline: string; person_id: string; date: string; minutes: number; version: number; state: 'reserved' | 'released'; task_workorder_id?: string | null; task_id?: number | null; assignment_id?: string | null; task_description?: string | null; plan_id?: string | null; plan_total_minutes?: number | null; remote_assignment_id?:string|null; plan_version?:number|null; plan_sync_state?:'local'|'unknown'|'synced'|null; upstream_baseline?: Record<string, unknown> | null; sync_state?: string; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type AssignmentSnapshot = { pool_id: string; pool_version: number; rows: ResourcePerson[]; items: Assignment[]; assignment_revision?:string };
export type AssignmentWorkOrder = { connection_id: string; site_id: string; workorder_id: string; wonum: string; description: string|null; status: string; eligible: boolean; schedstart?: string|null; schedfinish?: string|null; assignedtechname?: string|null };
export type PlannedLabor = { craft: string; labor_hours: number; quantity: number };
export type WorkOrderTaskAssignment = { assignment_id: string; task_id: number; laborcode: string | null; craft: string; scheduledate: string | null; labor_hours: number | null; status: string; revision: string | null };
export type WorkOrderTask = { task_workorder_id: string; task_id: number; description: string; planned_labor: PlannedLabor[]; assignments: WorkOrderTaskAssignment[]; has_out_of_scope_demand?: boolean };
export type WorkOrderTasks = { connection_id: string; site_id: string; workorder_id: string; discipline?: string; upload_enabled: boolean; daily_plan_upload_supported:boolean; tasks: WorkOrderTask[]; planning_summary?:PlanningSummary };
export type TaskAllocationInput = Omit<AssignmentInput, 'request_id'|'minutes'> & { request_id: string; tasks: Array<{ task_workorder_id: string; task_id: number; assignment_id: string | null; minutes: number }> };
export type TaskAllocationBatch = { request_id: string; items: Assignment[]; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type TaskPlanInput = { connection_id:string; site_id:string; workorder_id:string; discipline:string; person_id:string; task_workorder_id:string; task_id:number; assignment_id:string; total_minutes:number; request_id:string; segments:Array<{date:string;minutes:number}> };
export type TaskPlanBatch = { request_id:string; plan_id:string; items:Assignment[]; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type TaskPlanBatchInput = { connection_id:string; site_id:string; workorder_id:string; discipline:string; person_id:string; request_id:string; tasks:Array<{task_workorder_id:string;task_id:number;assignment_id:string;total_minutes:number;segments:Array<{date:string;minutes:number}>}> };
export type TaskPlanBatchResult = { request_id:string; plans:Array<{plan_id:string;task_workorder_id:string;task_id:number;assignment_id:string;total_minutes:number;items:Assignment[]}>; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type AssignmentPlanMoveMode='shift'|'reallocate';
export type AssignmentPlanMoveRequest={connection_id:string;discipline:string;expected_plan_version:number;anchor_allocation_id:string;target_person_id:string;target_date:string;mode:AssignmentPlanMoveMode};
export type AssignmentPlanMovePreview=AssignmentPlanMoveRequest & {plan_id:string;plan_version:number;pool_id:string;task_workorder_id:string;task_id:number;assignment_id:string;source_person_id:string;source_laborcode:string;target_laborcode:string;original_demand_minutes:number;total_minutes:number;old_items:Assignment[];segments:Array<{date:string;minutes:number}>;capacity:Array<{person_id:string;date:string;laborcode:string;capacity_minutes:number;allocated_minutes:number;remaining_minutes:number;proposed_minutes:number;remaining_after_minutes:number}>};
export type AssignmentPlanMoveInput=AssignmentPlanMoveRequest & {request_id:string;segments:Array<{date:string;minutes:number}>};
export type AssignmentPlanMoveResult={request_id:string;plan_id:string;plan_version:number;items:Assignment[];affected_days?:AffectedCapacityDay[];allocation_updates?:Assignment[];planning_summary?:PlanningSummary;assignment_revision?:string;previous_assignment_revision?:string;work_order?:AssignmentWorkOrder};
export type AssignmentUploadResult = { attempt_id:string; allocation_id:string; request_id:string; state:'confirmed'|'conflict'|'unknown'|'failed'; detail?:string };
export type AssignmentPlanPreview = {plan_id:string;plan_version:number;preview_token:string;expires_at:string;timezone:string;source_assignment_id:string;connection_id:string;site_id:string;workorder_id:string;task_workorder_id:string;task_id:number;person_id:string;laborcode:string|null;segments:Array<{allocation_id:string;version:number;date:string;minutes:number;scheduled_start:string;scheduled_finish:string;remote_assignment_id:string|null}>;total_minutes:number;can_upload:true;reason:null};
export type AssignmentPlanUploadResult = {attempt_id:string;request_id:string;plan_id:string;state:'unknown'|'confirmed'|'conflict'|'failed';mapping:Array<{allocation_id:string;date:string;assignment_id:string}>|null;items?:Assignment[];affected_days?:AffectedCapacityDay[];planning_summary?:PlanningSummary;allocation_updates?:Assignment[];assignment_revision?:string;previous_assignment_revision?:string;work_order?:AssignmentWorkOrder};
export type PlanUploadBatchState='previewing'|'ready'|'running'|'completed';
export type PlanUploadBatchItemState='pending'|'ready'|'blocked'|'skipped'|'queued'|'sending'|'confirmed'|'failed'|'conflict'|'unknown';
export type PlanUploadBatchSegment={allocation_id:string;version:number;date:string;minutes:number;scheduled_start:string;scheduled_finish:string};
export type PlanUploadBatchItem=({item_id:string;kind:'plan'|'legacy';state:PlanUploadBatchItemState;reason:string|null;plan_id:string|null;allocation_id:string|null;connection_id:string;site_id:string;workorder_id:string;wonum:string|null;workorder_description:string|null;task_workorder_id:string|null;task_id:number|null;task_description:string|null;person_id:string;person_name:string|null;laborcode:string;source_assignment_id:string|null;plan_version:number|null;total_minutes:number;segments:PlanUploadBatchSegment[];attempt_id:string|null;receipt:AssignmentPlanUploadResult|null})|{item_id:string;kind:'plan'|'legacy';state:PlanUploadBatchItemState;reason:'scope_unavailable';redacted:true};
export type PlanUploadBatch={batch_id:string;request_id:string;confirmation_request_id:string|null;pool_id:string;connection_id:string;discipline:string;month:string;start_time:string;state:PlanUploadBatchState;expires_at:string|null;counts:{total:number;pending:number;ready:number;blocked:number;skipped:number;queued:number;sending:number;confirmed:number;failed:number;conflict:number;unknown:number};next_item_id:string|null;items:PlanUploadBatchItem[];has_more:boolean;next_cursor:string|null;changed_item:PlanUploadBatchItem|null};
export type ResourceTimeline = AssignmentSnapshot & { work_orders: AssignmentWorkOrder[] };
export type AssignmentRevision = { pool_id:string; connection_id:string; discipline:string; revision:string };
export type AssignmentScope = { connection_id: string; site_id: string; workorder_id: string; discipline: string; date_from: string; date_before: string };
export type AssignmentInput = Omit<AssignmentScope, 'date_from' | 'date_before'> & { person_id: string; date: string; minutes: number; request_id: string };
export class AssignmentError extends RetrievalError { constructor(status: number, message: string, readonly outcome?: 'not_sent', readonly code?:string) { super(status, message); } }
const record = (v: unknown): v is Record<string, unknown> => isRecord(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
function parsePlanningSummary(value:unknown):PlanningSummary|undefined {
  if(value===undefined)return undefined;
  if(!record(value)||!['unverified','unallocated','partial','completed'].includes(String(value.state))||!(value.remaining_minutes===null||Number.isInteger(value.remaining_minutes)&&Number(value.remaining_minutes)>=0)||!(value.remaining_tasks===null||Number.isInteger(value.remaining_tasks)&&Number(value.remaining_tasks)>=0)||!(value.total_tasks===null||Number.isInteger(value.total_tasks)&&Number(value.total_tasks)>=0)||!(value.verified_at===null||typeof value.verified_at==='string'))throw new Error('Tổng hợp phân bổ WO không hợp lệ.');
  if(value.state==='unverified'&&value.verified_at!==null)throw new Error('Tổng hợp chưa xác minh không được có thời điểm xác minh.');
  if(value.state==='completed'&&(value.remaining_minutes!==0||value.remaining_tasks!==0||value.verified_at===null))throw new Error('WO chỉ được xác nhận Completed khi đã phân bổ đủ và có xác minh.');
  return value as PlanningSummary;
}
function parseAffectedDays(value:unknown):AffectedCapacityDay[]|undefined {
  if(value===undefined)return undefined;
  if(!Array.isArray(value))throw new Error('Danh sách ngày bị ảnh hưởng không hợp lệ.');
  return value.map(day=>{
    if(!record(day)||!['pool_id','person_id','craft','laborcode','date'].every(key=>str(day[key]))||typeof day.code!=='string'||typeof day.load_complete!=='boolean'||!['capacity_minutes','allocated_minutes','local_minutes','external_minutes','synced_minutes'].every(key=>Number.isInteger(day[key])&&Number(day[key])>=0)||!Number.isInteger(day.remaining_minutes)||Number(day.remaining_minutes)!==Number(day.capacity_minutes)-Number(day.allocated_minutes))throw new Error('Capacity ngày bị ảnh hưởng không hợp lệ.');
    return day as unknown as AffectedCapacityDay;
  });
}
function parseAssignmentRevision(value:unknown):string|undefined { if(value===undefined)return undefined;if(typeof value!=='string'||!value)throw new Error('Phiên bản phân công không hợp lệ.');return value; }
function mutationMetadata(value:Record<string,unknown>){
  const allocation_updates=value.allocation_updates===undefined?undefined:(()=>{if(!Array.isArray(value.allocation_updates))throw new Error('Danh sách assignment được làm mới không hợp lệ.');return value.allocation_updates.map(update=>parseAssignment(update,false));})();
  let work_order:AssignmentWorkOrder|undefined;
  if(value.work_order!==undefined){const raw=value.work_order;if(!record(raw)||!['connection_id','site_id','workorder_id','wonum','status'].every(key=>str(raw[key]))||!(raw.description===null||typeof raw.description==='string')||typeof raw.eligible!=='boolean')throw new Error('Thông tin WO hiện tại không hợp lệ.');work_order=raw as unknown as AssignmentWorkOrder;}
  return {affected_days:parseAffectedDays(value.affected_days),allocation_updates,planning_summary:parsePlanningSummary(value.planning_summary),assignment_revision:parseAssignmentRevision(value.assignment_revision),previous_assignment_revision:parseAssignmentRevision(value.previous_assignment_revision),work_order};
}
function validDateOnly(value:string){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);const leap=year%4===0&&(year%100!==0||year%400===0);
  const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];return year>0&&month>=1&&month<=12&&day>=1&&day<=monthDays[month-1];
}
function parseAssignment(v: unknown,includeMetadata=true): Assignment {
  if (!record(v) || !['id','pool_id','connection_id','site_id','workorder_id','discipline','person_id','date'].every(k => str(v[k])) ||
    !Number.isInteger(v.minutes) || Number(v.minutes) < 1 || Number(v.minutes) > 630 || !Number.isInteger(v.version) || Number(v.version) < 1 || !['reserved','released'].includes(String(v.state))) throw new Error('Bản ghi phân công không hợp lệ.');
  const optionalStrings=['task_workorder_id','assignment_id','task_description','sync_state','plan_id','remote_assignment_id'];
  if(optionalStrings.some(key=>v[key]!==undefined&&v[key]!==null&&typeof v[key]!=='string') ||
    v.task_id!==undefined&&v.task_id!==null&&(!Number.isInteger(v.task_id)||Number(v.task_id)<0) ||
    (v.task_id!==undefined&&v.task_id!==null)!==!!v.task_workorder_id ||
    v.task_id!==undefined&&v.task_id!==null&&!str(v.assignment_id) ||
    v.task_description!==undefined&&v.task_description!==null&&typeof v.task_description!=='string' ||
    v.upstream_baseline!==undefined&&v.upstream_baseline!==null&&!record(v.upstream_baseline) ||
    v.plan_total_minutes!==undefined&&v.plan_total_minutes!==null&&(!Number.isInteger(v.plan_total_minutes)||Number(v.plan_total_minutes)<1) ||
    v.plan_id!==undefined&&v.plan_id!==null&&(!Number.isInteger(v.plan_total_minutes)||Number(v.plan_total_minutes)<1) ||
    v.plan_version!==undefined&&v.plan_version!==null&&(!Number.isInteger(v.plan_version)||Number(v.plan_version)<1) ||
    v.plan_sync_state!==undefined&&v.plan_sync_state!==null&&!['local','unknown','synced'].includes(String(v.plan_sync_state))) throw new Error('Định danh task trong phân công không đầy đủ hoặc không hợp lệ.');
  const assignment={...v};
  delete assignment.date_from;
  delete assignment.date_before;
  return { ...assignment, ...(includeMetadata?mutationMetadata(v):{}) } as unknown as Assignment;
}
function parseSnapshot(v: unknown): AssignmentSnapshot {
  if (!record(v) || !str(v.pool_id) || !Number.isInteger(v.pool_version) || !Array.isArray(v.rows) || !Array.isArray(v.items)) throw new Error('Dữ liệu phân bổ nhân lực không hợp lệ.');
  const rows = v.rows.map((row): ResourcePerson => {
    if (!record(row) || !['person_id','name','craft','role','laborcode'].every(k => str(row[k])) || !Array.isArray(row.days)) throw new Error('Thông tin nhân lực không hợp lệ.');
    const days = row.days.map((day): CapacityDay => {
      if (!record(day) || !str(day.date) || typeof day.code !== 'string' || typeof day.load_complete!=='boolean' || !['capacity_minutes','allocated_minutes','local_minutes','external_minutes','synced_minutes'].every(k => Number.isInteger(day[k]) && Number(day[k]) >= 0) || !Number.isInteger(day.remaining_minutes) || day.remaining_minutes !== Number(day.capacity_minutes) - Number(day.allocated_minutes)) throw new Error('Thông tin tải người/ngày chưa đầy đủ hoặc không hợp lệ.');
      return day as unknown as CapacityDay;
    });
    return { ...row, days } as ResourcePerson;
  });
  const items = v.items.map(value=>parseAssignment(value));
  if (items.some(item => item.pool_id !== v.pool_id)) throw new Error('Phân công thuộc pool khác.');
  return { pool_id: v.pool_id, pool_version: Number(v.pool_version), rows, items, ...(v.assignment_revision===undefined?{}:{assignment_revision:parseAssignmentRevision(v.assignment_revision)}) };
}
async function request(path: string, signal: AbortSignal, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.method && init.method !== 'GET') {
    const csrf = document.cookie.split('; ').find(part => part.startsWith('__Host-wos-csrf='))?.split('=')[1];
    if (!csrf) throw new AssignmentError(401, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.', 'not_sent');
    headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  const response = await fetch(`${config.apiBase}${path}`, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    let message = response.status === 409 ? 'Rota hoặc phân bổ đã thay đổi; hãy tải lại trước khi sửa.' : response.status === 403 ? 'Bạn không còn quyền phân bổ nhân lực cho WO này.' : response.status === 401 ? 'Phiên đăng nhập đã hết hạn.' : 'Không thể hoàn tất thao tác phân bổ.';
    let outcome: 'not_sent' | undefined;
    let code:string|undefined;
    try { const body: unknown = await response.json(); if (record(body) && str(body.detail)) message = body.detail;
      else if(record(body)&&record(body.detail)){if(str(body.detail.message))message=body.detail.message;if(body.detail.outcome==='not_sent')outcome='not_sent';if(str(body.detail.code))code=body.detail.code;}
    } catch { /* Keep scoped fallback. */ }
    throw new AssignmentError(response.status, message, outcome, code);
  }
  return response;
}
async function json<T>(path: string, signal: AbortSignal, init: RequestInit | undefined, parse: (v: unknown) => T): Promise<T> {
  const response = await request(path, signal, init);
  let raw: unknown; try { raw = await response.json(); } catch { throw new Error('Phản hồi API không phải JSON hợp lệ.'); }
  return parse(raw);
}
export type PlanUploadBatchScope={pool_id:string;connection_id:string;discipline:string;month:string};
const batchItemStates:PlanUploadBatchItemState[]=['pending','ready','blocked','skipped','queued','sending','confirmed','failed','conflict','unknown'];
function parsePlanUploadBatchItem(value:unknown,scope:PlanUploadBatchScope):PlanUploadBatchItem{
  if(!record(value)||!str(value.item_id)||!['plan','legacy'].includes(String(value.kind))||!batchItemStates.includes(value.state as PlanUploadBatchItemState))throw new Error('Một mục trong batch upload kế hoạch không hợp lệ.');
  if(value.reason==='scope_unavailable'&&Object.keys(value).every(key=>['item_id','kind','state','reason'].includes(key)))return {...value,redacted:true} as PlanUploadBatchItem;
  const strings=['connection_id','site_id','workorder_id','person_id','laborcode'];
  if(!strings.every(key=>str(value[key]))||!(value.wonum===null||str(value.wonum))||value.connection_id!==scope.connection_id||!(value.workorder_description===null||typeof value.workorder_description==='string')||!(value.person_name===null||typeof value.person_name==='string')||!(value.task_workorder_id===null||str(value.task_workorder_id))||!(value.task_id===null||Number.isInteger(value.task_id)&&Number(value.task_id)>=0)||!(value.task_description===null||typeof value.task_description==='string')||!(value.plan_id===null||uuid(value.plan_id))||!(value.allocation_id===null||uuid(value.allocation_id))||!(value.source_assignment_id===null||str(value.source_assignment_id))||!(value.plan_version===null||Number.isInteger(value.plan_version)&&Number(value.plan_version)>0)||!Number.isInteger(value.total_minutes)||Number(value.total_minutes)<0||!(value.attempt_id===null||uuid(value.attempt_id))||!(value.reason===null||typeof value.reason==='string')||!Array.isArray(value.segments)||value.segments.length>366)throw new Error('Danh tính, trạng thái hoặc giờ trong batch upload không hợp lệ.');
  if(value.kind==='plan'&&(!value.plan_id||!value.source_assignment_id||!value.task_workorder_id||value.task_id===null||value.plan_version===null||!value.segments.length)||value.kind==='legacy'&&value.plan_id!==null)throw new Error('Loại kế hoạch không khớp dữ liệu batch.');
  const segments=value.segments.map(segment=>{if(!record(segment)||!uuid(segment.allocation_id)||!Number.isInteger(segment.version)||Number(segment.version)<1||!validDateOnly(String(segment.date))||!Number.isInteger(segment.minutes)||Number(segment.minutes)<1||Number(segment.minutes)>630||!awareDateTime(segment.scheduled_start)||!awareDateTime(segment.scheduled_finish)||Date.parse(segment.scheduled_finish)-Date.parse(segment.scheduled_start)!==Number(segment.minutes)*60_000)throw new Error('Phân đoạn batch không hợp lệ.');return segment as unknown as PlanUploadBatchSegment;});
  const reservedMinutes=segments.reduce((sum,segment)=>sum+segment.minutes,0);
  const completeDemand=['ready','queued','sending','confirmed'].includes(String(value.state));
  if(new Set(segments.map(segment=>segment.allocation_id)).size!==segments.length||reservedMinutes>Number(value.total_minutes)||completeDemand&&reservedMinutes!==Number(value.total_minutes))throw new Error('Phân đoạn batch trùng hoặc sai tổng giờ.');
  let receipt:AssignmentPlanUploadResult|null=null;
  if(value.receipt!==null){if(!record(value.receipt)||!str(value.receipt.request_id)||!value.plan_id)throw new Error('Receipt trong batch không hợp lệ.');receipt=parsePlanUpload(value.receipt,value.receipt.request_id,String(value.plan_id));}
  return {...value,segments,receipt} as unknown as PlanUploadBatchItem;
}
function parsePlanUploadBatch(value:unknown,scope:PlanUploadBatchScope,expectedRequestId?:string,expectedConfirmationId?:string,expectedEitherId?:string):PlanUploadBatch{
  const body=record(value)&&record(value.result)?value.result:value;
  if(!record(body)||!uuid(body.batch_id)||!uuid(body.request_id)||expectedRequestId&&body.request_id!==expectedRequestId||expectedConfirmationId&&body.confirmation_request_id!==expectedConfirmationId||expectedEitherId&&body.request_id!==expectedEitherId&&body.confirmation_request_id!==expectedEitherId||!(body.confirmation_request_id===null||uuid(body.confirmation_request_id))||body.pool_id!==scope.pool_id||body.connection_id!==scope.connection_id||body.discipline!==scope.discipline||body.month!==scope.month||typeof body.start_time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.start_time)||!['previewing','ready','running','completed'].includes(String(body.state))||!(body.expires_at===null||awareDateTime(body.expires_at))||!record(body.counts)||!Array.isArray(body.items)||body.items.length>20||!(body.next_item_id===null||uuid(body.next_item_id))||typeof body.has_more!=='boolean'||!(body.next_cursor===null||typeof body.next_cursor==='string'&&/^\d+$/.test(body.next_cursor))||!(body.changed_item===null||record(body.changed_item)))throw new Error('Batch upload không khớp phạm vi đã chọn hoặc envelope không hợp lệ.');
  const countKeys=['total','pending','ready','blocked','skipped','queued','sending','confirmed','failed','conflict','unknown'] as const;
  const rawCounts=body.counts as Record<string,unknown>;
  if(!countKeys.every(key=>Number.isInteger(rawCounts[key])&&Number(rawCounts[key])>=0)||Number(rawCounts.total)>1000||countKeys.slice(1).reduce((sum,key)=>sum+Number(rawCounts[key]),0)!==Number(rawCounts.total)||body.has_more!==!!body.next_cursor)throw new Error('Tổng trạng thái batch không hợp lệ.');
  const items=body.items.map(item=>parsePlanUploadBatchItem(item,scope));
  if(new Set(items.map(item=>item.item_id)).size!==items.length)throw new Error('Danh sách batch chứa mục trùng.');
  const changed_item=body.changed_item===null?null:parsePlanUploadBatchItem(body.changed_item,scope);
  return {...body,counts:rawCounts,items,changed_item} as unknown as PlanUploadBatch;
}
const batchPath=(batchId:string)=>`/plan-upload-batches/${encodeURIComponent(batchId)}`;
export async function createPlanUploadBatch(poolId:string,scope:Omit<PlanUploadBatchScope,'pool_id'>,requestId:string,startTime:string,signal:AbortSignal){
  if(!uuid(requestId)||!/^\d{4}-\d\d$/.test(scope.month)||!validDateOnly(`${scope.month}-01`)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime))throw new Error('Tháng, giờ bắt đầu hoặc mã yêu cầu batch không hợp lệ.');
  const expected={...scope,pool_id:poolId};
  return json(`/resource-pools/${encodeURIComponent(poolId)}/plan-upload-batches`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,month:scope.month,start_time:startTime})},value=>parsePlanUploadBatch(value,expected,requestId));
}
export async function getPlanUploadBatch(poolId:string,batchId:string,scope:Omit<PlanUploadBatchScope,'pool_id'>,cursor:string|null,signal:AbortSignal){
  if(cursor!==null&&!/^\d+$/.test(cursor))throw new Error('Vị trí trang batch không hợp lệ.');
  const query=new URLSearchParams({cursor:cursor??'0'});
  return json(`${batchPath(batchId)}?${query}`,signal,undefined,value=>{const parsed=parsePlanUploadBatch(value,{...scope,pool_id:poolId});if(parsed.pool_id!==poolId)throw new Error('Batch thuộc resource pool khác.');return parsed;});
}
export async function getLatestPlanUploadBatch(poolId:string,scope:Omit<PlanUploadBatchScope,'pool_id'>,signal:AbortSignal):Promise<PlanUploadBatch|null>{
  const query=new URLSearchParams({month:scope.month});try{return await json(`/resource-pools/${encodeURIComponent(poolId)}/plan-upload-batches?${query}`,signal,undefined,value=>parsePlanUploadBatch(value,{...scope,pool_id:poolId}));}catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}
export async function lookupPlanUploadBatchSubmission(requestId:string,scope:PlanUploadBatchScope,signal:AbortSignal):Promise<PlanUploadBatch|null>{
  try{return await json(`/plan-upload-batch-submissions/${encodeURIComponent(requestId)}`,signal,undefined,value=>parsePlanUploadBatch(value,scope,undefined,undefined,requestId));}catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}
export async function prepareNextPlanUploadBatch(batchId:string,scope:PlanUploadBatchScope,signal:AbortSignal){return json(`${batchPath(batchId)}/prepare-next`,signal,{method:'POST'},value=>parsePlanUploadBatch(value,scope));}
export async function confirmPlanUploadBatch(batchId:string,requestId:string,scope:PlanUploadBatchScope,signal:AbortSignal){if(!uuid(requestId))throw new Error('Mã xác nhận batch không hợp lệ.');return json(`${batchPath(batchId)}/confirm`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId})},value=>parsePlanUploadBatch(value,scope,undefined,requestId));}
export async function continuePlanUploadBatch(batchId:string,itemId:string,scope:PlanUploadBatchScope,signal:AbortSignal){if(!uuid(itemId))throw new Error('Mục tiếp theo của batch không hợp lệ.');return json(`${batchPath(batchId)}/continue`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:itemId})},value=>parsePlanUploadBatch(value,scope));}
export async function getAssignments(poolId: string, scope: AssignmentScope, signal: AbortSignal): Promise<AssignmentSnapshot> {
  const { date_from, date_before, ...identity } = scope;
  const query = new URLSearchParams({ ...identity, date_from, date_before });
  const data = await json(`/resource-pools/${encodeURIComponent(poolId)}/assignments?${query}`, signal, undefined, parseSnapshot);
  if (data.pool_id !== poolId) throw new Error('API trả resource pool khác với pool đã chọn.');
  if (data.items.some(item => item.connection_id !== scope.connection_id || item.site_id !== scope.site_id || item.workorder_id !== scope.workorder_id || item.discipline !== scope.discipline || item.date < scope.date_from || item.date >= scope.date_before)) throw new Error('API trả phân công ngoài phạm vi WO đang mở.');
  return data;
}
export async function getResourceTimeline(poolId: string, scope: Omit<AssignmentScope, 'site_id' | 'workorder_id'>, signal: AbortSignal): Promise<ResourceTimeline> {
  const query = new URLSearchParams(scope);
  const data = await json(`/resource-pools/${encodeURIComponent(poolId)}/assignment-timeline?${query}`, signal, undefined, value => {
    if (!record(value) || !Array.isArray(value.work_orders)) throw new Error('Dữ liệu Resource timeline không hợp lệ.');
    const snapshot = parseSnapshot(value);
    const work_orders = value.work_orders.map((raw): AssignmentWorkOrder => {
      if (!record(raw) || !['connection_id','site_id','workorder_id','wonum','status'].every(key => str(raw[key])) ||
          !(raw.description === null || typeof raw.description === 'string') || typeof raw.eligible !== 'boolean' ||
          !['schedstart','schedfinish','assignedtechname'].every(key => raw[key] === undefined || raw[key] === null || typeof raw[key] === 'string')) throw new Error('WO trong Resource timeline không hợp lệ.');
      return raw as unknown as AssignmentWorkOrder;
    });
    if (new Set(work_orders.map(item => `${item.site_id}:${item.workorder_id}`)).size !== work_orders.length ||
        work_orders.some(item => item.connection_id !== scope.connection_id) ||
        snapshot.rows.some(row => row.craft !== scope.discipline || row.days.some(day => day.date < scope.date_from || day.date >= scope.date_before)) ||
        snapshot.items.some(item => item.connection_id !== scope.connection_id || item.discipline !== scope.discipline || item.date < scope.date_from || item.date >= scope.date_before)) throw new Error('API trả dữ liệu ngoài phạm vi Resource timeline.');
    const people = new Set(snapshot.rows.map(row => row.person_id));
    if (snapshot.items.some(item => !people.has(item.person_id))) throw new Error('Phân công không thuộc roster đang hoạt động.');
    return { ...snapshot, work_orders };
  });
  if (data.pool_id !== poolId) throw new Error('API trả resource pool khác với pool đã chọn.');
  return data;
}
export async function getAssignmentRevision(poolId:string,connectionId:string,discipline:string,signal:AbortSignal):Promise<AssignmentRevision>{
  const query=new URLSearchParams({connection_id:connectionId,discipline});
  return json(`/resource-pools/${encodeURIComponent(poolId)}/assignment-revision?${query}`,signal,undefined,value=>{
    if(!record(value)||value.pool_id!==poolId||value.connection_id!==connectionId||value.discipline!==discipline||!str(value.revision))throw new Error('Phiên bản phân công ngoài phạm vi đang chọn hoặc không hợp lệ.');
    return value as unknown as AssignmentRevision;
  });
}
export async function getWorkOrderTasks(connectionId: string, siteId: string, workOrderId: string, discipline: string, signal: AbortSignal): Promise<WorkOrderTasks> {
  const query = new URLSearchParams({ discipline });
  const path = `/work-orders/${encodeURIComponent(connectionId)}/${encodeURIComponent(siteId)}/${encodeURIComponent(workOrderId)}/tasks?${query}`;
  return json(path, signal, undefined, value => {
    if (!record(value) || value.connection_id !== connectionId || value.site_id !== siteId || value.workorder_id !== workOrderId || value.discipline !== undefined && value.discipline !== discipline || !Array.isArray(value.tasks)) throw new Error('Danh sách task không thuộc WO hoặc phạm vi đang chọn.');
    const tasks = value.tasks.map((raw): WorkOrderTask => {
      if (!record(raw) || !str(raw.task_workorder_id) || !Number.isInteger(raw.task_id) || !(raw.description === null || typeof raw.description === 'string') || !Array.isArray(raw.planned_labor) || !Array.isArray(raw.assignments) || raw.has_out_of_scope_demand !== undefined && typeof raw.has_out_of_scope_demand !== 'boolean') throw new Error('Thông tin task không hợp lệ.');
      const planned_labor = raw.planned_labor.map((item): PlannedLabor => {
        const laborHours = record(item) ? Number(item.labor_hours) : NaN;
        const quantity = record(item) ? Number(item.quantity) : NaN;
        if (!record(item) || !str(item.craft) || !Number.isFinite(laborHours) || laborHours < 0 || !Number.isFinite(quantity) || quantity < 0) throw new Error('Nhu cầu labor task không hợp lệ.');
        return { craft:item.craft, labor_hours:laborHours, quantity };
      });
      const assignments = raw.assignments.map((item): WorkOrderTaskAssignment => {
        const assignmentId = record(item) ? String(item.assignment_id ?? '') : '';
        const taskHours = record(item) && item.labor_hours !== null ? Number(item.labor_hours) : null;
        if (!record(item) || !str(assignmentId) || !Number.isInteger(item.task_id) || !(item.laborcode === null || typeof item.laborcode === 'string') || !str(item.craft) || !(item.scheduledate === null || typeof item.scheduledate === 'string') || !(taskHours === null || Number.isFinite(taskHours)) || !str(item.status) || !(item.revision === null || typeof item.revision === 'string')) throw new Error('Thông tin assignment Maximo không hợp lệ.');
        return { assignment_id:assignmentId, task_id:Number(item.task_id), laborcode:item.laborcode, craft:item.craft, scheduledate:item.scheduledate, labor_hours:taskHours, status:item.status, revision:item.revision };
      });
      if (assignments.some(item => item.task_id !== raw.task_id)) throw new Error('Assignment tham chiếu task khác.');
      return { task_workorder_id: raw.task_workorder_id, task_id: Number(raw.task_id), description: String(raw.description ?? ''), planned_labor, assignments, ...(raw.has_out_of_scope_demand === undefined ? {} : {has_out_of_scope_demand:raw.has_out_of_scope_demand as boolean}) };
    });
    const ids = new Set(tasks.map(task => `${task.task_workorder_id}:${task.task_id}`));
    if (ids.size !== tasks.length) throw new Error('WO có task bị trùng trong phản hồi.');
    const assignmentIds = tasks.flatMap(task => task.assignments.map(item => item.assignment_id));
    if (new Set(assignmentIds).size !== assignmentIds.length) throw new Error('WO có assignment trùng giữa các task.');
    if (typeof value.upload_enabled !== 'boolean') throw new Error('Backend chưa xác nhận trạng thái upload Maximo.');
    if (value.discipline !== undefined && value.discipline !== discipline) throw new Error('Tasks thuộc discipline khác phạm vi được cấp quyền.');
    if(value.daily_plan_upload_supported!==undefined&&typeof value.daily_plan_upload_supported!=='boolean')throw new Error('Cờ đồng bộ kế hoạch theo ngày không hợp lệ.');
    return { connection_id: connectionId, site_id: siteId, workorder_id: workOrderId, discipline, upload_enabled:value.upload_enabled, daily_plan_upload_supported:value.daily_plan_upload_supported===true, tasks, planning_summary:parsePlanningSummary(value.planning_summary) };
  });
}
export async function saveTaskAllocations(poolId: string, input: TaskAllocationInput, signal: AbortSignal): Promise<TaskAllocationBatch> {
  const keys=input.tasks.map(task=>`${task.task_workorder_id}:${task.task_id}:${task.assignment_id??''}`);
  if(input.tasks.length<1 || input.tasks.length>50 || input.tasks.some(task=>!str(task.task_workorder_id)||!Number.isInteger(task.task_id)||task.task_id<0||!str(task.assignment_id)||!Number.isInteger(task.minutes)||task.minutes<1||task.minutes>630) || new Set(keys).size!==keys.length) throw new Error('Batch task phải có 1–50 assignment WAITASGN hợp lệ, không trùng.');
  return json(`/resource-pools/${encodeURIComponent(poolId)}/task-allocations`, signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, value => {
    if (!record(value) || value.request_id !== input.request_id || !Array.isArray(value.items)) throw new Error('Phản hồi batch task không khớp yêu cầu.');
    const items = value.items.map(item=>parseAssignment(item));
    if (items.length !== input.tasks.length || items.some(item => item.connection_id !== input.connection_id || item.site_id !== input.site_id || item.workorder_id !== input.workorder_id || item.person_id !== input.person_id || item.date !== input.date || item.discipline !== input.discipline || item.state !== 'reserved')) throw new Error('Kết quả batch task không khớp đúng người, WO hoặc ngày.');
    const selected = new Set(input.tasks.map(task => `${task.task_workorder_id}:${task.task_id}:${task.assignment_id ?? ''}:${task.minutes}`));
    if (items.some(item => !selected.has(`${item.task_workorder_id}:${item.task_id}:${item.assignment_id ?? ''}:${item.minutes}`))) throw new Error('Kết quả batch task không khớp task hoặc giờ đã gửi.');
    return { request_id: input.request_id, items, ...mutationMetadata(value) };
  });
}
export async function lookupTaskAllocationRequest(requestId:string,signal:AbortSignal):Promise<TaskAllocationBatch|null>{
  try {
    return await json(`/assignment-submissions/${encodeURIComponent(requestId)}`,signal,undefined,value=>{
      if(!record(value) || !record(value.result) || value.result.request_id!==requestId || !Array.isArray(value.result.items)) throw new Error('Biên nhận batch task không hợp lệ.');
      const items=value.result.items.map(item=>parseAssignment(item));
      if(!items.length) throw new Error('Biên nhận batch task trống.');
      return {request_id:requestId,items,...mutationMetadata({...value,...value.result})};
    });
  } catch(error) { if(error instanceof AssignmentError && error.status===404)return null; throw error; }
}

function parseTaskPlanBatch(value:unknown,requestId:string,input?:TaskPlanInput):TaskPlanBatch{
  const body=record(value)&&record(value.result)?value.result:value;
  if(!record(body)||body.request_id!==requestId||!str(body.plan_id)||!Array.isArray(body.items))throw new Error('Biên nhận kế hoạch nhiều ngày không hợp lệ.');
  const items=body.items.map(item=>parseAssignment(item));
  if(!items.length||items.some(item=>item.plan_id!==body.plan_id||item.plan_total_minutes!==input?.total_minutes))throw new Error('Các phân đoạn không cùng plan_id hoặc tổng giờ kế hoạch.');
  const dates=items.map(item=>item.date);
  if(new Set(dates).size!==dates.length||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('Kế hoạch có ngày hoặc phân đoạn trùng.');
  if(input){
    const expected=[...input.segments].sort((a,b)=>a.date.localeCompare(b.date));
    const actual=[...items].sort((a,b)=>a.date.localeCompare(b.date));
    if(body.request_id!==input.request_id||items.length!==expected.length||actual.some((item,index)=>{
      const segment=expected[index];return !segment||item.connection_id!==input.connection_id||item.site_id!==input.site_id||item.workorder_id!==input.workorder_id||item.discipline!==input.discipline||item.person_id!==input.person_id||item.task_workorder_id!==input.task_workorder_id||item.task_id!==input.task_id||item.assignment_id!==input.assignment_id||item.state!=='reserved'||item.date!==segment.date||item.minutes!==segment.minutes;
    })||items.reduce((sum,item)=>sum+item.minutes,0)!==input.total_minutes)throw new Error('Kết quả kế hoạch nhiều ngày không khớp chính xác yêu cầu.');
  }
  return {request_id:requestId,plan_id:body.plan_id,items,...mutationMetadata({...value as Record<string,unknown>,...body})};
}
export async function saveTaskPlan(poolId:string,input:TaskPlanInput,signal:AbortSignal):Promise<TaskPlanBatch>{
  const segments=[...input.segments].sort((a,b)=>a.date.localeCompare(b.date));
  if(!str(input.connection_id)||!str(input.site_id)||!str(input.workorder_id)||!str(input.discipline)||!str(input.person_id)||!str(input.task_workorder_id)||!Number.isInteger(input.task_id)||input.task_id<0||!str(input.assignment_id)||!str(input.request_id)||!Number.isInteger(input.total_minutes)||input.total_minutes<1||input.total_minutes>366*630||segments.length<1||segments.length>366||segments.some(segment=>!validDateOnly(segment.date)||!Number.isInteger(segment.minutes)||segment.minutes<1||segment.minutes>630)||new Set(segments.map(segment=>segment.date)).size!==segments.length||segments.reduce((sum,segment)=>sum+segment.minutes,0)!==input.total_minutes)throw new Error('Kế hoạch phải có ngày duy nhất, giờ hợp lệ và tổng giờ khớp.');
  return json(`/resource-pools/${encodeURIComponent(poolId)}/task-plans`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,segments})},value=>parseTaskPlanBatch(value,input.request_id,input));
}

function planMovePath(poolId:string,planId:string){return `/resource-pools/${encodeURIComponent(poolId)}/assignment-plans/${encodeURIComponent(planId)}`;}
function validatePlanMoveRequest(poolId:string,planId:string,input:AssignmentPlanMoveRequest){if(!str(poolId)||!str(planId)||!str(input.connection_id)||!str(input.discipline)||!Number.isInteger(input.expected_plan_version)||input.expected_plan_version<1||!str(input.anchor_allocation_id)||!str(input.target_person_id)||!validDateOnly(input.target_date)||!['shift','reallocate'].includes(input.mode))throw new Error('Yêu cầu chuyển toàn task không hợp lệ.');}
function parsePlanMovePreview(value:unknown,poolId:string,planId:string,input:AssignmentPlanMoveRequest,knownItems:Assignment[]):AssignmentPlanMovePreview{
  const body=record(value)&&record(value.result)?value.result:value;
  if(!record(body)||body.pool_id!==poolId||body.plan_id!==planId||body.plan_version!==input.expected_plan_version||body.connection_id!==input.connection_id||body.discipline!==input.discipline||body.anchor_allocation_id!==input.anchor_allocation_id||body.target_person_id!==input.target_person_id||body.target_date!==input.target_date||body.mode!==input.mode||!str(body.task_workorder_id)||!Number.isInteger(body.task_id)||!str(body.assignment_id)||!str(body.source_person_id)||!str(body.source_laborcode)||!str(body.target_laborcode)||!Number.isInteger(body.original_demand_minutes)||Number(body.original_demand_minutes)<0||!Number.isInteger(body.total_minutes)||Number(body.total_minutes)<1||!Array.isArray(body.old_items)||!Array.isArray(body.segments)||!Array.isArray(body.capacity))throw new Error('Preview chuyển task không khớp phạm vi hoặc không hợp lệ.');
  const oldItems=body.old_items.map(item=>parseAssignment(item));
  const knownAnchor=knownItems.find(item=>item.id===input.anchor_allocation_id);
  if(!knownAnchor||knownItems.some(item=>item.plan_id!==planId||item.pool_id!==poolId||item.connection_id!==input.connection_id||item.site_id!==knownAnchor.site_id||item.workorder_id!==knownAnchor.workorder_id||item.discipline!==input.discipline||item.person_id!==knownAnchor.person_id||item.task_workorder_id!==knownAnchor.task_workorder_id||item.task_id!==knownAnchor.task_id||item.assignment_id!==knownAnchor.assignment_id||item.state!=='reserved'||(item.plan_sync_state??item.sync_state??'local')!=='local'||!!item.remote_assignment_id)||oldItems.length===0||oldItems.some(item=>item.plan_id!==planId||item.pool_id!==poolId||item.plan_version!==undefined&&item.plan_version!==input.expected_plan_version||item.connection_id!==input.connection_id||item.site_id!==knownAnchor.site_id||item.workorder_id!==knownAnchor.workorder_id||item.discipline!==input.discipline||item.person_id!==body.source_person_id||item.task_workorder_id!==body.task_workorder_id||item.task_id!==body.task_id||item.assignment_id!==body.assignment_id||item.state!=='reserved'||(item.plan_sync_state??item.sync_state??'local')!=='local'||!!item.remote_assignment_id)||!oldItems.some(item=>item.id===input.anchor_allocation_id)||new Set(oldItems.map(item=>item.id)).size!==oldItems.length||new Set(oldItems.map(item=>item.date)).size!==oldItems.length||oldItems.reduce((sum,item)=>sum+item.minutes,0)!==body.total_minutes||knownItems.some(known=>!oldItems.some(item=>item.id===known.id&&item.version===known.version&&item.date===known.date&&item.minutes===known.minutes&&item.plan_id===planId&&item.person_id===knownAnchor.person_id&&item.site_id===knownAnchor.site_id&&item.workorder_id===knownAnchor.workorder_id&&item.assignment_id===knownAnchor.assignment_id)))throw new Error('Preview không khớp các phân đoạn hiện có của task.');
  const segments=body.segments.map(segment=>{if(!record(segment)||!validDateOnly(String(segment.date))||!Number.isInteger(segment.minutes)||Number(segment.minutes)<1||Number(segment.minutes)>630)throw new Error('Phân bổ mới trong preview không hợp lệ.');return {date:String(segment.date),minutes:Number(segment.minutes)};});
  if(!segments.length||segments.length>366||new Set(segments.map(segment=>segment.date)).size!==segments.length||segments.reduce((sum,segment)=>sum+segment.minutes,0)!==body.total_minutes)throw new Error('Tổng giờ hoặc ngày trong preview chuyển task không khớp.');
  const capacity=body.capacity.map(day=>{if(!record(day)||!str(day.person_id)||!validDateOnly(String(day.date))||!str(day.laborcode)||!['capacity_minutes','allocated_minutes','remaining_minutes','proposed_minutes','remaining_after_minutes'].every(key=>Number.isInteger(day[key]))||Number(day.capacity_minutes)<0||Number(day.allocated_minutes)<0||Number(day.proposed_minutes)<0||Number(day.remaining_minutes)!==Number(day.capacity_minutes)-Number(day.allocated_minutes)||Number(day.remaining_after_minutes)!==Number(day.remaining_minutes)-Number(day.proposed_minutes))throw new Error('Capacity trong preview chuyển task không hợp lệ.');return day as unknown as AssignmentPlanMovePreview['capacity'][number];});
  if(new Set(capacity.map(day=>`${day.person_id}|${day.date}`)).size!==capacity.length||capacity.some(day=>day.person_id!==input.target_person_id||day.laborcode!==body.target_laborcode||day.capacity_minutes>630||day.proposed_minutes>630||day.remaining_after_minutes<0)||segments.some(segment=>!capacity.some(day=>day.person_id===input.target_person_id&&day.date===segment.date&&day.proposed_minutes===segment.minutes)))throw new Error('Capacity preview không bao phủ đủ các ngày và giờ đề xuất.');
  return {...input,plan_id:planId,plan_version:Number(body.plan_version),pool_id:poolId,task_workorder_id:String(body.task_workorder_id),task_id:Number(body.task_id),assignment_id:String(body.assignment_id),source_person_id:String(body.source_person_id),source_laborcode:String(body.source_laborcode),target_laborcode:String(body.target_laborcode),original_demand_minutes:Number(body.original_demand_minutes),total_minutes:Number(body.total_minutes),old_items:oldItems,segments,capacity};
}
export async function previewAssignmentPlanMove(poolId:string,planId:string,input:AssignmentPlanMoveRequest,knownItems:Assignment[],signal:AbortSignal):Promise<AssignmentPlanMovePreview>{
  validatePlanMoveRequest(poolId,planId,input);
  return json(`${planMovePath(poolId,planId)}/move-preview`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},value=>parsePlanMovePreview(value,poolId,planId,input,knownItems));
}
function parsePlanMoveResult(value:unknown,poolId:string,planId:string,input:AssignmentPlanMoveInput,expected:AssignmentPlanMovePreview):AssignmentPlanMoveResult{
  const body=record(value)&&record(value.result)?value.result:value;
  if(!record(body)||body.request_id!==input.request_id||body.plan_id!==planId||!Number.isInteger(body.plan_version)||![expected.plan_version,expected.plan_version+1].includes(Number(body.plan_version))||!Array.isArray(body.items))throw new Error('Biên nhận chuyển task không hợp lệ.');
  const items=body.items.map(item=>parseAssignment(item));
  const segments=[...input.segments].sort((a,b)=>a.date.localeCompare(b.date));const reserved=items.filter(item=>item.state==='reserved').sort((a,b)=>a.date.localeCompare(b.date));const released=items.filter(item=>item.state==='released');
  if(!items.length||reserved.length!==segments.length||new Set(items.map(item=>item.id)).size!==items.length||new Set(reserved.map(item=>item.date)).size!==reserved.length||items.some(item=>item.plan_id!==planId||item.pool_id!==poolId||item.connection_id!==input.connection_id||item.site_id!==expected.old_items[0].site_id||item.workorder_id!==expected.old_items[0].workorder_id||item.discipline!==input.discipline||item.task_workorder_id!==expected.task_workorder_id||item.task_id!==expected.task_id||item.assignment_id!==expected.assignment_id||item.plan_version!==undefined&&item.plan_version!==Number(body.plan_version)||item.plan_sync_state&&item.plan_sync_state!=='local'||item.sync_state&&item.sync_state!=='local'||!!item.remote_assignment_id)||reserved.some((item,index)=>{const segment=segments[index];return !segment||item.person_id!==input.target_person_id||item.date!==segment.date||item.minutes!==segment.minutes;})||released.some(item=>item.person_id!==expected.source_person_id||!expected.old_items.some(old=>old.id===item.id&&old.date===item.date&&old.minutes===item.minutes))||reserved.reduce((sum,item)=>sum+item.minutes,0)!==expected.total_minutes)throw new Error('Biên nhận chuyển task không khớp chính xác preview.');
  return {request_id:input.request_id,plan_id:planId,plan_version:Number(body.plan_version),items,...mutationMetadata({...value as Record<string,unknown>,...body})};
}
export async function moveAssignmentPlan(poolId:string,planId:string,input:AssignmentPlanMoveInput,preview:AssignmentPlanMovePreview,signal:AbortSignal):Promise<AssignmentPlanMoveResult>{
  validatePlanMoveRequest(poolId,planId,input);
  if(!str(input.request_id)||input.segments.length!==preview.segments.length||input.segments.some(segment=>!preview.segments.some(expected=>expected.date===segment.date&&expected.minutes===segment.minutes)))throw new Error('Yêu cầu chuyển task khác preview đã xác nhận.');
  return json(`${planMovePath(poolId,planId)}/move`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,request_id:input.request_id,segments:input.segments})},value=>parsePlanMoveResult(value,poolId,planId,input,preview));
}
export async function lookupAssignmentPlanMoveRequest(requestId:string,poolId:string,planId:string,input:AssignmentPlanMoveInput,preview:AssignmentPlanMovePreview,signal:AbortSignal):Promise<AssignmentPlanMoveResult|null>{
  try{return await json(`/assignment-submissions/${encodeURIComponent(requestId)}`,signal,undefined,value=>parsePlanMoveResult(value,poolId,planId,input,preview));}catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}

export type AssignmentPlanIdentity = Pick<Assignment,'plan_id'|'connection_id'|'site_id'|'workorder_id'|'person_id'|'task_workorder_id'|'task_id'|'assignment_id'|'plan_total_minutes'> & {segments:Array<Pick<Assignment,'id'|'date'|'minutes'|'version'>>};
const awareDateTime=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function dateInZone(value:string,timezone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return `${parts.find(part=>part.type==='year')?.value}-${parts.find(part=>part.type==='month')?.value}-${parts.find(part=>part.type==='day')?.value}`;}
function parsePlanPreview(value:unknown, expected:AssignmentPlanIdentity,startTime:string):AssignmentPlanPreview {
  if(!record(value)||value.plan_id!==expected.plan_id||!Number.isInteger(value.plan_version)||Number(value.plan_version)<1||!uuid(value.preview_token)||!awareDateTime(value.expires_at)||!str(value.timezone)||value.source_assignment_id!==expected.assignment_id||value.connection_id!==expected.connection_id||value.site_id!==expected.site_id||value.workorder_id!==expected.workorder_id||value.task_workorder_id!==expected.task_workorder_id||value.task_id!==expected.task_id||value.person_id!==expected.person_id||!(value.laborcode===null||str(value.laborcode))||!Array.isArray(value.segments)||!Number.isInteger(value.total_minutes)||value.total_minutes!==expected.plan_total_minutes||value.can_upload!==true||value.reason!==null)throw new Error('Preview đồng bộ kế hoạch không thuộc phân công hiện tại hoặc không hợp lệ.');
  try{new Intl.DateTimeFormat('en',{timeZone:String(value.timezone)}).format();}catch{throw new Error('Múi giờ của preview không hợp lệ.');}
  const segments=value.segments.map(segment=>{if(!record(segment)||!str(segment.allocation_id)||!Number.isInteger(segment.version)||Number(segment.version)<1||!validDateOnly(String(segment.date))||!Number.isInteger(segment.minutes)||Number(segment.minutes)<1||Number(segment.minutes)>630||!awareDateTime(segment.scheduled_start)||!awareDateTime(segment.scheduled_finish)||!(segment.remote_assignment_id===null||str(segment.remote_assignment_id)))throw new Error('Phân đoạn preview không hợp lệ.');const starts=Date.parse(segment.scheduled_start),finishes=Date.parse(segment.scheduled_finish);const localStart=new Intl.DateTimeFormat('en-GB',{timeZone:String(value.timezone),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(starts));if(finishes-starts!==Number(segment.minutes)*60000||localStart!==startTime||dateInZone(segment.scheduled_start,String(value.timezone))!==segment.date||dateInZone(segment.scheduled_finish,String(value.timezone))!==segment.date)throw new Error('Giờ bắt đầu/kết thúc preview không khớp phút và ngày theo múi giờ kế hoạch.');return segment as unknown as AssignmentPlanPreview['segments'][number];});
  const expectedSegments=[...expected.segments].sort((a,b)=>a.date.localeCompare(b.date));const datesSorted=segments.map(segment=>segment.date).sort();
  const span=datesSorted.length?Math.floor((Date.parse(`${datesSorted.at(-1)}T00:00:00Z`)-Date.parse(`${datesSorted[0]}T00:00:00Z`))/86400000):0;
  if(segments.length<expectedSegments.length||segments.length>366||span>365||new Set(segments.map(x=>x.allocation_id)).size!==segments.length||new Set(segments.map(x=>x.date)).size!==segments.length||expectedSegments.some(expectedSegment=>!segments.some(segment=>segment.allocation_id===expectedSegment.id&&segment.date===expectedSegment.date&&segment.minutes===expectedSegment.minutes&&segment.version===expectedSegment.version))||segments.reduce((sum,x)=>sum+x.minutes,0)!==value.total_minutes)throw new Error('Preview không khớp chính xác các phân đoạn kế hoạch đã lưu.');
  return value as unknown as AssignmentPlanPreview;
}
export async function previewAssignmentPlan(poolId:string,expected:AssignmentPlanIdentity,startTime:string,signal:AbortSignal):Promise<AssignmentPlanPreview>{
  if(!expected.plan_id||!/^\d\d:\d\d$/.test(startTime)||Number(startTime.slice(0,2))>23||Number(startTime.slice(3))>59)throw new Error('Kế hoạch hoặc giờ bắt đầu không hợp lệ.');
  return json(`/assignment-plans/${encodeURIComponent(expected.plan_id)}/upload-preview?start_time=${encodeURIComponent(startTime)}`,signal,undefined,value=>parsePlanPreview(value,expected,startTime));
}
function parsePlanUpload(value:unknown,requestId:string,planId:string,preview?:AssignmentPlanPreview):AssignmentPlanUploadResult{
  const body=record(value)&&record(value.result)?value.result:value;
  if(!record(body)||!str(body.attempt_id)||body.request_id!==requestId||body.plan_id!==planId||!['unknown','confirmed','conflict','failed'].includes(String(body.state))||!(body.mapping===null||Array.isArray(body.mapping)))throw new Error('Biên nhận đồng bộ kế hoạch không hợp lệ.');
  let mapping:AssignmentPlanUploadResult['mapping']=null;
  if(Array.isArray(body.mapping)){
    mapping=body.mapping.map(row=>{if(!record(row)||!str(row.allocation_id)||!validDateOnly(String(row.date))||!str(row.assignment_id))throw new Error('Mapping ngày và assignment Maximo không hợp lệ.');return row as unknown as NonNullable<AssignmentPlanUploadResult['mapping']>[number];});
    if(new Set(mapping.map(row=>row.allocation_id)).size!==mapping.length||new Set(mapping.map(row=>row.date)).size!==mapping.length)throw new Error('Biên nhận có mapping phân đoạn trùng.');
  }
  if(body.state==='confirmed'&&preview&&(mapping===null||mapping.length!==preview.segments.length||preview.segments.some(segment=>!mapping!.some(row=>row.allocation_id===segment.allocation_id&&row.date===segment.date))))throw new Error('Mapping xác nhận không bao phủ đúng toàn bộ kế hoạch preview.');
  const metadata=mutationMetadata(body);
  const items=body.items===undefined?undefined:(()=>{if(!Array.isArray(body.items))throw new Error('Danh sách phân đoạn cập nhật không hợp lệ.');return body.items.map(item=>parseAssignment(item,false));})();
  if(items){
    if(new Set(items.map(item=>item.id)).size!==items.length||new Set(items.map(item=>item.date)).size!==items.length||items.some(item=>item.plan_id!==planId||item.state!=='reserved'))throw new Error('Các phân đoạn receipt không cùng plan hoặc bị trùng.');
    if(preview&&(items.length!==preview.segments.length||preview.segments.some(segment=>{const item=items.find(candidate=>candidate.id===segment.allocation_id);const mappedId=mapping?.find(row=>row.allocation_id===segment.allocation_id)?.assignment_id;return !item||item.connection_id!==preview.connection_id||item.site_id!==preview.site_id||item.workorder_id!==preview.workorder_id||item.person_id!==preview.person_id||item.task_workorder_id!==preview.task_workorder_id||item.task_id!==preview.task_id||item.assignment_id!==preview.source_assignment_id||item.date!==segment.date||item.minutes!==segment.minutes||body.state==='confirmed'&&item.remote_assignment_id!==mappedId;})))throw new Error('Các phân đoạn receipt không khớp scope và mapping của preview.');
  }
  return {attempt_id:body.attempt_id,request_id:requestId,plan_id:planId,state:body.state as AssignmentPlanUploadResult['state'],mapping,...(items?{items}:{}),...metadata};
}
export async function uploadAssignmentPlan(planId:string,requestId:string,preview:AssignmentPlanPreview,signal:AbortSignal):Promise<AssignmentPlanUploadResult>{
  if(!str(planId)||preview.plan_id!==planId||!str(requestId)||!preview.can_upload)throw new Error('Preview không còn hợp lệ để gửi.');
  return json(`/assignment-plans/${encodeURIComponent(planId)}/upload`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,plan_version:preview.plan_version,preview_token:preview.preview_token})},value=>parsePlanUpload(value,requestId,planId,preview));
}
export async function lookupAssignmentPlanUpload(requestId:string,planId:string,preview:AssignmentPlanPreview|undefined,signal:AbortSignal):Promise<AssignmentPlanUploadResult|null>{
  try{return await json(`/assignment-plan-upload-submissions/${encodeURIComponent(requestId)}`,signal,undefined,value=>parsePlanUpload(value,requestId,planId,preview));}catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}
export async function getAssignmentPlanUpload(attemptId:string,requestId:string,planId:string,preview:AssignmentPlanPreview|undefined,signal:AbortSignal):Promise<AssignmentPlanUploadResult>{return json(`/assignment-plan-uploads/${encodeURIComponent(attemptId)}`,signal,undefined,value=>parsePlanUpload(value,requestId,planId,preview));}
export async function reconcileAssignmentPlanUpload(attemptId:string,requestId:string,planId:string,preview:AssignmentPlanPreview|undefined,signal:AbortSignal):Promise<AssignmentPlanUploadResult>{return json(`/assignment-plan-uploads/${encodeURIComponent(attemptId)}/reconcile`,signal,{method:'POST'},value=>parsePlanUpload(value,requestId,planId,preview));}
export type AssignmentPlanStatusScope = Pick<Assignment,'pool_id'|'connection_id'|'site_id'|'workorder_id'|'discipline'|'person_id'|'task_workorder_id'|'task_id'|'assignment_id'|'plan_total_minutes'> & {items:Assignment[]};
export async function getAssignmentPlanUploadStatus(planId:string,expected:AssignmentPlanStatusScope,signal:AbortSignal):Promise<AssignmentPlanUploadResult|null>{
  try{return await json(`/assignment-plans/${encodeURIComponent(planId)}/upload-status`,signal,undefined,value=>{const body=record(value)&&record(value.result)?value.result:value;if(!record(body)||!str(body.request_id))throw new Error('Trạng thái upload kế hoạch không hợp lệ.');const result=parsePlanUpload(value,body.request_id,planId);if(!result.items||result.items.length>366||result.items.reduce((sum,item)=>sum+item.minutes,0)!==expected.plan_total_minutes||result.items.some(item=>item.pool_id!==expected.pool_id||item.connection_id!==expected.connection_id||item.site_id!==expected.site_id||item.workorder_id!==expected.workorder_id||item.discipline!==expected.discipline||item.person_id!==expected.person_id||item.task_workorder_id!==expected.task_workorder_id||item.task_id!==expected.task_id||item.assignment_id!==expected.assignment_id)||expected.items.some(old=>!result.items!.some(item=>item.id===old.id&&item.date===old.date&&item.minutes===old.minutes))||(result.state==='confirmed'&&(!result.mapping||result.mapping.length!==result.items.length))||result.mapping?.some(row=>{const item=result.items!.find(candidate=>candidate.id===row.allocation_id);return !item||row.date!==item.date||result.state==='confirmed'&&item.remote_assignment_id!==row.assignment_id;}))throw new Error('Biên nhận trạng thái không khớp đầy đủ kế hoạch, scope và mapping.');return result;});}catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}
export async function lookupTaskPlanRequest(requestId:string,input:Omit<TaskPlanInput,'request_id'>,signal:AbortSignal):Promise<TaskPlanBatch|null>{
  try{return await json(`/assignment-submissions/${encodeURIComponent(requestId)}`,signal,undefined,value=>parseTaskPlanBatch(value,requestId,{...input,request_id:requestId}));}
  catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}
function parseTaskPlanBatchResult(value:unknown,requestId:string,input?:TaskPlanBatchInput):TaskPlanBatchResult{
  const body=record(value)&&record(value.result)?value.result:value;
  if(!record(body)||body.request_id!==requestId||!Array.isArray(body.plans))throw new Error('Biên nhận phân bổ task nhiều ngày không hợp lệ.');
  const plans=body.plans.map((raw):TaskPlanBatchResult['plans'][number]=>{
    if(!record(raw)||!str(raw.plan_id)||!str(raw.task_workorder_id)||!Number.isInteger(raw.task_id)||!str(raw.assignment_id)||!Number.isInteger(raw.total_minutes)||Number(raw.total_minutes)<1||!Array.isArray(raw.items))throw new Error('Kế hoạch task trong biên nhận không hợp lệ.');
    const items=raw.items.map(item=>parseAssignment(item));
    if(!items.length||new Set(items.map(item=>item.id)).size!==items.length||new Set(items.map(item=>item.date)).size!==items.length||items.some(item=>item.plan_id!==raw.plan_id||item.plan_total_minutes!==raw.total_minutes||item.task_workorder_id!==raw.task_workorder_id||item.task_id!==raw.task_id||item.assignment_id!==raw.assignment_id||item.state!=='reserved')||items.reduce((sum,item)=>sum+item.minutes,0)!==raw.total_minutes)throw new Error('Các phân đoạn task không khớp plan hoặc tổng giờ.');
    return {plan_id:raw.plan_id,task_workorder_id:raw.task_workorder_id,task_id:Number(raw.task_id),assignment_id:raw.assignment_id,total_minutes:Number(raw.total_minutes),items};
  });
  const responseItems=plans.flatMap(plan=>plan.items);
  if(new Set(plans.map(plan=>plan.plan_id)).size!==plans.length||new Set(plans.map(plan=>`${plan.task_workorder_id}:${plan.task_id}`)).size!==plans.length||new Set(plans.map(plan=>plan.assignment_id)).size!==plans.length||new Set(responseItems.map(item=>item.id)).size!==responseItems.length)throw new Error('Biên nhận batch có plan, task, assignment hoặc phân đoạn trùng.');
  if(input){
    if(plans.length!==input.tasks.length||new Set(plans.map(plan=>`${plan.task_workorder_id}:${plan.task_id}:${plan.assignment_id}`)).size!==plans.length)throw new Error('Kết quả batch không khớp các task đã gửi.');
    for(const requested of input.tasks){
      const plan=plans.find(candidate=>candidate.task_workorder_id===requested.task_workorder_id&&candidate.task_id===requested.task_id&&candidate.assignment_id===requested.assignment_id);
      if(!plan||plan.total_minutes!==requested.total_minutes||plan.items.some(item=>item.connection_id!==input.connection_id||item.site_id!==input.site_id||item.workorder_id!==input.workorder_id||item.discipline!==input.discipline||item.person_id!==input.person_id)||plan.items.length!==requested.segments.length)throw new Error('Kết quả task không khớp người, WO hoặc tổng giờ đã gửi.');
      const segments=[...requested.segments].sort((a,b)=>a.date.localeCompare(b.date));const items=[...plan.items].sort((a,b)=>a.date.localeCompare(b.date));
      if(items.some((item,index)=>item.date!==segments[index]?.date||item.minutes!==segments[index]?.minutes))throw new Error('Kết quả task không khớp chính xác ngày hoặc giờ đã gửi.');
    }
  }
  return {request_id:requestId,plans,...mutationMetadata({...value as Record<string,unknown>,...body})};
}
export async function saveTaskPlanBatch(poolId:string,input:TaskPlanBatchInput,signal:AbortSignal):Promise<TaskPlanBatchResult>{
  const keys=input.tasks.map(task=>`${task.task_workorder_id}:${task.task_id}:${task.assignment_id}`);
  if(!str(input.connection_id)||!str(input.site_id)||!str(input.workorder_id)||!str(input.discipline)||!str(input.person_id)||!str(input.request_id)||input.tasks.length<1||input.tasks.length>50||new Set(keys).size!==keys.length||new Set(input.tasks.map(task=>task.assignment_id)).size!==input.tasks.length||input.tasks.some(task=>!str(task.task_workorder_id)||!Number.isInteger(task.task_id)||task.task_id<0||!str(task.assignment_id)||!Number.isInteger(task.total_minutes)||task.total_minutes<1||!task.segments.length||task.segments.length>366||task.segments.some(segment=>!validDateOnly(segment.date)||!Number.isInteger(segment.minutes)||segment.minutes<1||segment.minutes>630)||new Set(task.segments.map(segment=>segment.date)).size!==task.segments.length||task.segments.reduce((sum,segment)=>sum+segment.minutes,0)!==task.total_minutes))throw new Error('Batch kế hoạch phải có 1–50 task hợp lệ, ngày duy nhất và tổng giờ khớp.');
  return json(`/resource-pools/${encodeURIComponent(poolId)}/task-plan-batches`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},value=>parseTaskPlanBatchResult(value,input.request_id,input));
}
export async function lookupTaskPlanBatchRequest(requestId:string,input:Omit<TaskPlanBatchInput,'request_id'>,signal:AbortSignal):Promise<TaskPlanBatchResult|null>{
  try{return await json(`/assignment-submissions/${encodeURIComponent(requestId)}`,signal,undefined,value=>parseTaskPlanBatchResult(value,requestId,{...input,request_id:requestId}));}
  catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}
}
const parseUploadResult=(value:unknown):AssignmentUploadResult=>{
  if(!record(value)||!str(value.attempt_id)||!str(value.allocation_id)||!str(value.request_id)||!['confirmed','conflict','unknown','failed'].includes(String(value.state))||!(value.detail===undefined||typeof value.detail==='string')) throw new Error('Kết quả upload assignment không hợp lệ.');
  return value as unknown as AssignmentUploadResult;
};
export const uploadAssignment=(item:Assignment,request_id:string,scheduled_start:string,signal:AbortSignal)=>json(`/assignments/${encodeURIComponent(item.id)}/upload`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:item.version,request_id,scheduled_start})},value=>{
  const result=parseUploadResult(value);
  if(result.allocation_id!==item.id||result.request_id!==request_id)throw new Error('Upload response does not match request or assignment.');
  return result;
});
export const getAssignmentUpload=(attemptId:string,signal:AbortSignal)=>json(`/assignment-uploads/${encodeURIComponent(attemptId)}`,signal,undefined,parseUploadResult);
export const reconcileAssignmentUpload=(attemptId:string,signal:AbortSignal)=>json(`/assignment-uploads/${encodeURIComponent(attemptId)}/reconcile`,signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})},parseUploadResult);
export async function lookupAssignmentUploadSubmission(requestId:string,signal:AbortSignal):Promise<AssignmentUploadResult|null>{try{return await json(`/assignment-upload-submissions/${encodeURIComponent(requestId)}`,signal,undefined,parseUploadResult);}catch(error){if(error instanceof AssignmentError&&error.status===404)return null;throw error;}}
export const saveAssignment = (poolId: string, input: AssignmentInput, signal: AbortSignal) => json(`/resource-pools/${encodeURIComponent(poolId)}/assignments`, signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, parseAssignment);
export const updateAssignment = (id: string, input: AssignmentInput & { version: number }, signal: AbortSignal) => json(`/assignments/${encodeURIComponent(id)}`, signal, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, parseAssignment);
export async function deleteAssignment(item: Assignment, request_id: string, signal: AbortSignal): Promise<Assignment> {
  return json(`/assignments/${encodeURIComponent(item.id)}`, signal, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: item.version, request_id }) }, parseAssignment);
}
export async function lookupAssignmentRequest(requestId: string, signal: AbortSignal): Promise<Assignment | null> {
  try { return await json(`/assignment-submissions/${encodeURIComponent(requestId)}`, signal, undefined, v => {
    if (!record(v) || !record(v.result)) throw new Error('Kết quả đối soát không hợp lệ.');
    return parseAssignment(v.result);
  }); } catch (error) { if (error instanceof AssignmentError && error.status === 404) return null; throw error; }
}
