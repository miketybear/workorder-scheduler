import { config } from '../config';
import { isRecord, RetrievalError } from './workOrders';

export type CapacityDay = { date: string; code: string; capacity_minutes: number; allocated_minutes: number; remaining_minutes: number; local_minutes?: number; external_minutes?: number; synced_minutes?: number; load_complete?: boolean };
export type PlanningSummary = { state: 'unverified'|'unallocated'|'partial'|'completed'; remaining_minutes:number|null; remaining_tasks:number|null; total_tasks:number|null; verified_at:string|null };
export type AffectedCapacityDay = CapacityDay & { pool_id:string; person_id:string; craft:string; laborcode:string };
export type ResourcePerson = { person_id: string; name: string; craft: string; role: string; laborcode: string; days: CapacityDay[] };
export type Assignment = { id: string; pool_id: string; connection_id: string; site_id: string; workorder_id: string; discipline: string; person_id: string; date: string; minutes: number; version: number; state: 'reserved' | 'released'; task_workorder_id?: string | null; task_id?: number | null; assignment_id?: string | null; task_description?: string | null; plan_id?: string | null; plan_total_minutes?: number | null; upstream_baseline?: Record<string, unknown> | null; sync_state?: string; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type AssignmentSnapshot = { pool_id: string; pool_version: number; rows: ResourcePerson[]; items: Assignment[]; assignment_revision?:string };
export type AssignmentWorkOrder = { connection_id: string; site_id: string; workorder_id: string; wonum: string; description: string|null; status: string; eligible: boolean };
export type PlannedLabor = { craft: string; labor_hours: number; quantity: number };
export type WorkOrderTaskAssignment = { assignment_id: string; task_id: number; laborcode: string | null; craft: string; scheduledate: string | null; labor_hours: number | null; status: string; revision: string | null };
export type WorkOrderTask = { task_workorder_id: string; task_id: number; description: string; planned_labor: PlannedLabor[]; assignments: WorkOrderTaskAssignment[]; has_out_of_scope_demand?: boolean };
export type WorkOrderTasks = { connection_id: string; site_id: string; workorder_id: string; discipline?: string; upload_enabled: boolean; tasks: WorkOrderTask[]; planning_summary?:PlanningSummary };
export type TaskAllocationInput = Omit<AssignmentInput, 'request_id'|'minutes'> & { request_id: string; tasks: Array<{ task_workorder_id: string; task_id: number; assignment_id: string | null; minutes: number }> };
export type TaskAllocationBatch = { request_id: string; items: Assignment[]; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type TaskPlanInput = { connection_id:string; site_id:string; workorder_id:string; discipline:string; person_id:string; task_workorder_id:string; task_id:number; assignment_id:string; total_minutes:number; request_id:string; segments:Array<{date:string;minutes:number}> };
export type TaskPlanBatch = { request_id:string; plan_id:string; items:Assignment[]; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type TaskPlanBatchInput = { connection_id:string; site_id:string; workorder_id:string; discipline:string; person_id:string; request_id:string; tasks:Array<{task_workorder_id:string;task_id:number;assignment_id:string;total_minutes:number;segments:Array<{date:string;minutes:number}>}> };
export type TaskPlanBatchResult = { request_id:string; plans:Array<{plan_id:string;task_workorder_id:string;task_id:number;assignment_id:string;total_minutes:number;items:Assignment[]}>; affected_days?:AffectedCapacityDay[]; allocation_updates?:Assignment[]; planning_summary?:PlanningSummary; assignment_revision?:string; previous_assignment_revision?:string; work_order?:AssignmentWorkOrder };
export type AssignmentUploadResult = { attempt_id:string; allocation_id:string; request_id:string; state:'confirmed'|'conflict'|'unknown'|'failed'; detail?:string };
export type ResourceTimeline = AssignmentSnapshot & { work_orders: AssignmentWorkOrder[] };
export type AssignmentRevision = { pool_id:string; connection_id:string; discipline:string; revision:string };
export type AssignmentScope = { connection_id: string; site_id: string; workorder_id: string; discipline: string; date_from: string; date_before: string };
export type AssignmentInput = Omit<AssignmentScope, 'date_from' | 'date_before'> & { person_id: string; date: string; minutes: number; request_id: string };
export class AssignmentError extends RetrievalError { constructor(status: number, message: string, readonly outcome?: 'not_sent') { super(status, message); } }
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
  const optionalStrings=['task_workorder_id','assignment_id','task_description','sync_state','plan_id'];
  if(optionalStrings.some(key=>v[key]!==undefined&&v[key]!==null&&typeof v[key]!=='string') ||
    v.task_id!==undefined&&v.task_id!==null&&(!Number.isInteger(v.task_id)||Number(v.task_id)<0) ||
    (v.task_id!==undefined&&v.task_id!==null)!==!!v.task_workorder_id ||
    v.task_id!==undefined&&v.task_id!==null&&!str(v.assignment_id) ||
    v.task_description!==undefined&&v.task_description!==null&&typeof v.task_description!=='string' ||
    v.upstream_baseline!==undefined&&v.upstream_baseline!==null&&!record(v.upstream_baseline) ||
    v.plan_total_minutes!==undefined&&v.plan_total_minutes!==null&&(!Number.isInteger(v.plan_total_minutes)||Number(v.plan_total_minutes)<1) ||
    v.plan_id!==undefined&&v.plan_id!==null&&(!Number.isInteger(v.plan_total_minutes)||Number(v.plan_total_minutes)<1)) throw new Error('Định danh task trong phân công không đầy đủ hoặc không hợp lệ.');
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
    if (!csrf) throw new AssignmentError(401, 'Phiên chưa sẵn sàng. Hãy đăng nhập lại.');
    headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  const response = await fetch(`${config.apiBase}${path}`, { ...init, headers, signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    let message = response.status === 409 ? 'Rota hoặc phân bổ đã thay đổi; hãy tải lại trước khi sửa.' : response.status === 403 ? 'Bạn không còn quyền phân bổ nhân lực cho WO này.' : response.status === 401 ? 'Phiên đăng nhập đã hết hạn.' : 'Không thể hoàn tất thao tác phân bổ.';
    let outcome: 'not_sent' | undefined;
    try { const body: unknown = await response.json(); if (record(body) && str(body.detail)) message = body.detail;
      else if(record(body)&&record(body.detail)){if(str(body.detail.message))message=body.detail.message;if(body.detail.outcome==='not_sent')outcome='not_sent';}
    } catch { /* Keep scoped fallback. */ }
    throw new AssignmentError(response.status, message, outcome);
  }
  return response;
}
async function json<T>(path: string, signal: AbortSignal, init: RequestInit | undefined, parse: (v: unknown) => T): Promise<T> {
  const response = await request(path, signal, init);
  let raw: unknown; try { raw = await response.json(); } catch { throw new Error('Phản hồi API không phải JSON hợp lệ.'); }
  return parse(raw);
}
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
          !(raw.description === null || typeof raw.description === 'string') || typeof raw.eligible !== 'boolean') throw new Error('WO trong Resource timeline không hợp lệ.');
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
    return { connection_id: connectionId, site_id: siteId, workorder_id: workOrderId, discipline, upload_enabled:value.upload_enabled, tasks, planning_summary:parsePlanningSummary(value.planning_summary) };
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
