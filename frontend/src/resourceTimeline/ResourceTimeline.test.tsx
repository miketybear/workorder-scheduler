import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceTimeline } from './ResourceTimeline';
import { AssignmentError, type Assignment, type ResourceTimeline as Snapshot } from '../api/assignments';
import { RetrievalError } from '../api/workOrders';

const api = vi.hoisted(() => ({ settings: vi.fn(), auth: vi.fn(), pools: vi.fn(), timeline: vi.fn(), revision:vi.fn(), orders: vi.fn(), tasks:vi.fn(), save: vi.fn(), batch:vi.fn(), plan: vi.fn(), planReceipt: vi.fn(), planBatch: vi.fn(),planBatchReceipt:vi.fn(), planUploadPreview: vi.fn(), planUpload: vi.fn(), planUploadReceipt: vi.fn(), planUploadStatus: vi.fn(), planUploadReconcile: vi.fn(), planMovePreview:vi.fn(), planMove:vi.fn(), planMoveReceipt:vi.fn(), batchCreate: vi.fn(), batchLatest: vi.fn(), batchGet: vi.fn(), batchPrepare: vi.fn(), batchConfirm: vi.fn(), batchContinue: vi.fn(), batchSubmission: vi.fn(), update: vi.fn(), remove: vi.fn(), lookup: vi.fn(), upload:vi.fn(), uploadReceipt:vi.fn(), reconcile:vi.fn() }));
type TestTaskPlanPayload={request_id:string;tasks:Array<{task_workorder_id:string;task_id:number;assignment_id:string;total_minutes:number;segments:Array<{date:string;minutes:number}>}>};
function planBatchResponse(input:TestTaskPlanPayload){return {request_id:input.request_id,plans:input.tasks.map((task,index)=>({plan_id:`plan-${index}`,...task,items:task.segments.map((segment,segmentIndex)=>({...item,id:`plan-${index}-${segmentIndex}`,...segment,task_workorder_id:task.task_workorder_id,task_id:task.task_id,assignment_id:task.assignment_id,plan_id:`plan-${index}`,plan_total_minutes:task.total_minutes,sync_state:'local'}))}))};}
vi.mock('../api/settings', () => ({ getConnectionSettings: api.settings }));
vi.mock('../api/client', () => ({ getAuthSummary: api.auth }));
vi.mock('../api/rotaImports', () => ({ listResourcePools: api.pools }));
vi.mock('../api/assignments', async importOriginal => {
  const actual = await importOriginal<typeof import('../api/assignments')>();
  return { ...actual, getResourceTimeline: api.timeline,getAssignmentRevision:api.revision, getWorkOrderTasks:api.tasks, saveAssignment: api.save, saveTaskAllocations:api.batch, saveTaskPlan:api.plan,lookupTaskPlanRequest:api.planReceipt,saveTaskPlanBatch:api.planBatch,lookupTaskPlanBatchRequest:api.planBatchReceipt,previewAssignmentPlan:api.planUploadPreview,uploadAssignmentPlan:api.planUpload,lookupAssignmentPlanUpload:api.planUploadReceipt,getAssignmentPlanUploadStatus:api.planUploadStatus,reconcileAssignmentPlanUpload:api.planUploadReconcile,previewAssignmentPlanMove:api.planMovePreview,moveAssignmentPlan:api.planMove,lookupAssignmentPlanMoveRequest:api.planMoveReceipt,createPlanUploadBatch:api.batchCreate,getLatestPlanUploadBatch:api.batchLatest,getPlanUploadBatch:api.batchGet,prepareNextPlanUploadBatch:api.batchPrepare,confirmPlanUploadBatch:api.batchConfirm,continuePlanUploadBatch:api.batchContinue,lookupPlanUploadBatchSubmission:api.batchSubmission,updateAssignment: api.update, deleteAssignment: api.remove, lookupAssignmentRequest: api.lookup, lookupTaskAllocationRequest:api.lookup, uploadAssignment:api.upload,lookupAssignmentUploadSubmission:api.uploadReceipt,reconcileAssignmentUpload:api.reconcile };
});
vi.mock('../api/workOrders', async importOriginal => {
  const actual=await importOriginal<typeof import('../api/workOrders')>();
  return {...actual,retrieveWorkOrderPage:async(filter:import('../api/workOrders').WorkOrderPageFilter,signal:AbortSignal)=>{
    const result=await api.orders(filter,signal);
    if(!Array.isArray(result))return result;
    const items=result.filter(row=>{const complete=actual.effectiveAllocationSummary(row,Date.now()).state==='completed';return (filter.view==='all'||complete===(filter.view==='completed'))&&`${row.wonum} ${row.siteid} ${row.description??''}`.toLowerCase().includes(filter.search.toLowerCase());}).sort((a,b)=>(b.wopriority??-Infinity)-(a.wopriority??-Infinity));
    const index=Number(filter.cursor??0),page=items.slice(index*20,index*20+20);
    return {connection_id:filter.connection_id,discipline:filter.discipline,items:page,count:page.length,page_size:20,view:filter.view,search:filter.search,total_count:items.length,next_cursor:items.length>(index+1)*20?String(index+1):null,has_more:items.length>(index+1)*20,filter_revision:'filter1'};
  }};
});

const grant = { connection_id: 'conn', label: 'Onshore test', system: 'onshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'E&I', capability: 'write' } as const;
const session = { user: { id: 'planner-1', name: 'Planner', is_admin: false }, preferred_connection_id: 'conn', grants: [grant] };
const pool = { id: 'pool-1', label: 'BDPOC', connection_id: 'conn', connection_label: 'Onshore test', environment: 'test', orgid: 'BDPOC', timezone: grant.timezone, capability: 'write' as const };
const person = { person_id: 'person-1', name: 'Nguyen A', craft: 'E&I', role: 'TECH', laborcode: 'LAB-1', days: [
  ...['2026-10-05', '2026-10-06'].map(date => ({ date, code: 'D', capacity_minutes: 630, allocated_minutes: 0, remaining_minutes: 630, local_minutes:0,external_minutes:0,synced_minutes:0,load_complete:true })),
] };
const order = { connection_id: 'conn', site_id: 'SITE', workorder_id: 'wo-1', wonum: 'WO-1', description: 'Pump repair', status: 'WAPPR', eligible: true };
const workOrder = { siteid: 'SITE', wonum: 'WO-1', workorderid: 'wo-1', description: 'Pump repair', status: 'WAPPR', worktype: 'CM', targcompdate: '2026-10-31', wopriority: 2,
  wolo10: '0', bdpocdiscipline: 'E&I', location: 'P-1', systemid: 'SYS', schedstart: null, schedfinish: null, actstart: null, actfinish: null, wopriority_description: '2', lead: null, assignedtechname: null, estdur: '4', targstartdate: null } as unknown as import('../api/workOrders').WorkOrder;
const item: Assignment = { id: 'a-1', pool_id: pool.id, connection_id: 'conn', site_id: 'SITE', workorder_id: 'wo-1', discipline: 'E&I', person_id: person.person_id, date: '2026-10-05', minutes: 120, version: 1, state: 'reserved' };
const snapshot: Snapshot = { pool_id: pool.id, pool_version: 2, rows: [person], items: [], work_orders: [], assignment_revision:'r1' };
class TestIntersectionObserver {
  static instances:TestIntersectionObserver[]=[];
  targets=new Set<Element>();
  disconnected=false;
  constructor(private callback:IntersectionObserverCallback,readonly options:IntersectionObserverInit){TestIntersectionObserver.instances.push(this);}
  observe(target:Element){this.targets.add(target);}
  unobserve(target:Element){this.targets.delete(target);}
  disconnect(){this.disconnected=true;this.targets.clear();}
  takeRecords(){return [];}
  trigger(key:string){const target=[...this.targets].find(node=>(node as HTMLElement).dataset.summaryKey===key);if(target)this.callback([{target,isIntersecting:true,intersectionRatio:1,boundingClientRect:{} as DOMRect,intersectionRect:{} as DOMRect,rootBounds:null,time:0}],this as unknown as IntersectionObserver);}
}

function dragTo(source: HTMLElement, target: HTMLElement) {
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>target});
  fireEvent.pointerDown(source,{button:0,clientX:20,clientY:20,pointerId:1});
  fireEvent.pointerMove(source,{clientX:150,clientY:150,pointerId:1});
  fireEvent.pointerUp(source,{clientX:150,clientY:150,pointerId:1});
}
async function loaded(initial: Snapshot = snapshot, orders: Array<import('../api/workOrders').WorkOrder> = [workOrder]) {
  api.settings.mockResolvedValue({ session, connections: [{ connection_id: 'conn', url: 'https://example.invalid' }] });
  api.auth.mockResolvedValue({ available: true, session }); api.pools.mockResolvedValue([pool]);
  api.revision.mockResolvedValue({pool_id:pool.id,connection_id:'conn',discipline:'E&I',revision:'r1'});
  api.timeline.mockResolvedValue(initial); api.orders.mockResolvedValue(orders);
  const view = render(<ResourceTimeline />);
  await screen.findByText(/Nguyen A/);
  await screen.findByRole('table');
  await waitFor(()=>expect(api.orders).toHaveBeenCalled());
  await waitFor(()=>expect(screen.queryByText('Đang tải trang WO…')).not.toBeInTheDocument());
  return view;
}
async function waitLegacyDialog(){ await screen.findByText(/WO chưa có task/); }
const rowItem = (value: Assignment): Snapshot => ({ ...snapshot, items: [value], work_orders: [order] });
function calendarTestDates(start:string,end:string){const from=Date.parse(`${start}T00:00:00Z`);const through=Date.parse(`${end}T00:00:00Z`);const result:string[]=[];for(let time=from;time<=through;time+=86_400_000)result.push(new Date(time).toISOString().slice(0,10));return result;}
type BulkTestItem=Record<string,unknown>&{item_id:string;state:string;plan_id:string;task_id:number;task_workorder_id:string;source_assignment_id:string;total_minutes:number;segments:Array<{allocation_id:string;version:number;date:string;minutes:number;scheduled_start:string;scheduled_finish:string}>;receipt:unknown};
function bulkPlanItems(count:number):BulkTestItem[]{return Array.from({length:count},(_,index)=>({item_id:`00000000-0000-4000-8000-${String(index+100).padStart(12,'0')}`,kind:'plan',state:'pending',reason:null,plan_id:`00000000-0000-4000-8000-${String(index+200).padStart(12,'0')}`,allocation_id:null,connection_id:'conn',site_id:'SITE',workorder_id:`wo-${index+1}`,wonum:`WO-${String(index+1).padStart(3,'0')}`,workorder_description:`Work ${index+1}`,task_workorder_id:`task-${index+1}`,task_id:index+1,task_description:`Task ${index+1}`,person_id:person.person_id,person_name:person.name,laborcode:person.laborcode,source_assignment_id:`source-${index+1}`,plan_version:1,total_minutes:60,segments:[{allocation_id:`00000000-0000-4000-8000-${String(index+300).padStart(12,'0')}`,version:1,date:'2026-10-05',minutes:60,scheduled_start:'2026-10-05T06:30:00+07:00',scheduled_finish:'2026-10-05T07:30:00+07:00'}],attempt_id:null,receipt:null} as BulkTestItem));}
function bulkCounts(items:Array<Record<string,unknown>>){const counts={total:items.length,pending:0,ready:0,blocked:0,skipped:0,queued:0,sending:0,confirmed:0,failed:0,conflict:0,unknown:0};for(const item of items)counts[item.state as keyof typeof counts]++;return counts;}
function bulkEnvelope(items:Array<Record<string,unknown>>,state:string,next:string|null,changed:Record<string,unknown>|null,requestId='00000000-0000-4000-8000-000000000001',confirmationId:string|null=null){return {batch_id:'00000000-0000-4000-8000-000000000099',request_id:requestId,confirmation_request_id:confirmationId,pool_id:pool.id,connection_id:'conn',discipline:'E&I',month:'2026-10',start_time:'06:30',state,expires_at:state==='ready'?'2026-10-03T12:00:00+07:00':null,counts:bulkCounts(items),next_item_id:next,items:items.slice(0,20),has_more:items.length>20,next_cursor:items.length>20?'20':null,changed_item:changed};}
function bulkMutation(items:Array<Record<string,unknown>>,state:string,next:string|null,changed:Record<string,unknown>|null,requestId='00000000-0000-4000-8000-000000000001',confirmationId:string|null=null){return {...bulkEnvelope(items,state,next,changed,requestId,confirmationId),items:[],has_more:false,next_cursor:null};}
function mockBulkPages(items:Array<Record<string,unknown>>,state:string,next:string|null,requestId='00000000-0000-4000-8000-000000000001',confirmationId:string|null=null){api.batchGet.mockImplementation(async(_pool:string,batchId:string,_scope:unknown,cursor:string|null)=>{const start=Number(cursor??0);return {...bulkEnvelope(items,state,next,null,requestId,confirmationId),items:items.slice(start,start+20),has_more:items.length>start+20,next_cursor:items.length>start+20?String(start+20):null};});}

beforeEach(() => { vi.stubGlobal('PointerEvent',MouseEvent); vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-10-01T02:00:00Z'));
  for(const mock of Object.values(api))mock.mockReset();
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[]});
  api.save.mockImplementation(async (_pool: string, input: Record<string, unknown>) => ({ ...item, ...input, id: 'new-a', version: 1, state: 'reserved' }));
  api.update.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({ ...item, ...input, id: 'a-1', version: 2, state: 'reserved' }));
  api.remove.mockResolvedValue({ ...item, version: 2, state: 'released' }); api.lookup.mockResolvedValue(null);
  api.batch.mockImplementation(async (_pool:string,input:Record<string,unknown>)=>({request_id:input.request_id,items:[]}));
  api.planBatch.mockImplementation(async(_pool:string,input:TestTaskPlanPayload)=>planBatchResponse(input));
  api.save.mockImplementation(async (_pool:string,input:Record<string,unknown>)=>({...item,...input,id:'new-a',version:1,state:'reserved',affected_days:[{pool_id:pool.id,person_id:person.person_id,craft:'E&I',laborcode:'LAB-1',date:String(input.date),code:'D',capacity_minutes:630,allocated_minutes:Number(input.minutes),remaining_minutes:630-Number(input.minutes),local_minutes:Number(input.minutes),external_minutes:0,synced_minutes:0,load_complete:true}],planning_summary:{state:'partial',remaining_minutes:60,remaining_tasks:1,total_tasks:2,verified_at:'2026-10-01T09:00:00+07:00'},previous_assignment_revision:'r1',assignment_revision:'r2',work_order:order}));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document,'elementFromPoint'); });

it('shows compact status icons and a delayed, cancellable, keyboard-accessible assignment tooltip',async()=>{
  const compact={...item,task_id:20,task_workorder_id:'task-20',task_description:'Long description for inspection',plan_id:'plan-card',plan_total_minutes:240,plan_sync_state:'unknown',sync_state:'unknown'} as Assignment;
  await loaded({...snapshot,items:[compact],work_orders:[order]});
  const card=screen.getByRole('button',{name:/Long description for inspection.*Chờ đối soát Maximo, nhiều ngày/});
  expect(card).toHaveTextContent('T20 · WO-1 · 2h');
  expect(card).not.toHaveTextContent('Chờ đối soát');
  vi.useFakeTimers();
  fireEvent.pointerEnter(card);
  act(()=>{vi.advanceTimersByTime(1000);});
  fireEvent.pointerLeave(card);
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerEnter(card);
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(screen.getByRole('tooltip')).toHaveTextContent('Long description for inspection · WO-1 · Pump repair');
  fireEvent.keyDown(card,{key:'Escape'});
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerLeave(card);
  fireEvent.pointerEnter(card);
  act(()=>{vi.advanceTimersByTime(1000);});
  fireEvent.keyDown(card,{key:'Escape'});
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerLeave(card);
  fireEvent.pointerEnter(card);
  act(()=>{vi.advanceTimersByTime(1000);});
  fireEvent.scroll(window);
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerLeave(card);
  fireEvent.pointerEnter(card);
  act(()=>{vi.advanceTimersByTime(2000);});
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.pointerLeave(card);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.focus(card);
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.blur(card);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('paginates the sorted WO list in groups of 20 and keeps the selected WO across pages',async()=>{
  const orders=Array.from({length:45},(_,index)=>({...workOrder,wonum:`WO-${String(index+1).padStart(3,'0')}`,workorderid:`wo-${index+1}`}));
  const view=await loaded(snapshot,orders);
  expect(view.container.querySelectorAll('button[data-allocation-state]')).toHaveLength(20);
  expect(screen.getByText('Trang 1 · 20 WO / 45')).toBeInTheDocument();
  const selected=screen.getByRole('button',{name:/WO-001/});fireEvent.click(selected);
  fireEvent.click(screen.getByRole('button',{name:'Trang sau danh sách WO'}));
  await screen.findByText('Trang 2 · 20 WO / 45');
  expect(view.container.querySelectorAll('button[data-allocation-state]')).toHaveLength(20);
  expect(api.timeline).toHaveBeenCalledTimes(1);
  expect(api.orders.mock.calls[1][0]).toMatchObject({cursor:'1',view:'backlog',search:''});
  fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  await waitLegacyDialog();
  expect(screen.getByRole('combobox',{name:'Work Order'})).toHaveValue('SITE|wo-1');
  fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
  fireEvent.click(screen.getByRole('button',{name:'Trang trước danh sách WO'}));
  expect(await screen.findByRole('button',{name:/WO-001/})).toHaveAttribute('aria-pressed','true');
  fireEvent.change(screen.getByPlaceholderText('WO, site hoặc mô tả'),{target:{value:'WO-045'}});
  expect(await screen.findByText('Trang 1 · 1 WO / 1')).toBeInTheDocument();
  expect(view.container.querySelectorAll('button[data-allocation-state]')).toHaveLength(1);
});

it('ignores an aborted page response after switching the server filter',async()=>{
  const orders=Array.from({length:45},(_,index)=>({...workOrder,wonum:`WO-${String(index+1).padStart(3,'0')}`,workorderid:`wo-${index+1}`}));
  await loaded(snapshot,orders);
  let finish:(value:typeof orders)=>void=()=>{};
  api.orders.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'Trang sau danh sách WO'}));
  await waitFor(()=>expect(api.orders).toHaveBeenCalledTimes(2));
  const signal=api.orders.mock.calls[1][1] as AbortSignal;
  fireEvent.click(screen.getByRole('button',{name:'Tất cả'}));
  expect(await screen.findByRole('button',{name:/WO-001/})).toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  finish(orders);
  await waitFor(()=>expect(screen.queryByRole('button',{name:/WO-021/})).not.toBeInTheDocument());
  expect(api.timeline).toHaveBeenCalledTimes(1);
});

it('searches the whole server snapshot and refreshes metadata only once after explicit reload',async()=>{
  const orders=Array.from({length:150},(_,index)=>({...workOrder,wonum:`WO-${index}`,workorderid:`wo-${index}`}));
  await loaded(snapshot,orders);
  fireEvent.change(screen.getByRole('textbox',{name:'Tìm WO, site'}),{target:{value:'WO-149'}});
  expect(await screen.findByRole('button',{name:/WO-149/})).toBeInTheDocument();
  expect(screen.getByText('Trang 1 · 1 WO / 1')).toBeInTheDocument();
  expect(api.timeline).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Làm mới timeline'}));
  await waitFor(()=>expect(api.orders.mock.calls.some(call=>call[0].refresh===true)).toBe(true));
  await screen.findByRole('button',{name:/WO-149/});
  fireEvent.click(screen.getByRole('button',{name:'Tất cả'}));
  await waitFor(()=>expect(api.orders.mock.calls.at(-1)?.[0].view).toBe('all'));
  expect(api.orders.mock.calls.filter(call=>call[0].refresh===true)).toHaveLength(1);
});

it('resizes the backlog with keyboard and pointer while retaining a usable timeline column',async()=>{
  const view=await loaded();
  const separator=screen.getByRole('separator',{name:'Điều chỉnh độ rộng Backlog'});
  Object.defineProperty(separator.parentElement, 'clientWidth', {configurable:true,value:900});
  const initial=Number(separator.getAttribute('aria-valuenow'));
  fireEvent.keyDown(separator,{key:'ArrowRight'});
  expect(Number(separator.getAttribute('aria-valuenow'))).toBe(initial+20);
  fireEvent.keyDown(separator,{key:'Home'});
  expect(separator).toHaveAttribute('aria-valuenow','220');
  fireEvent.pointerDown(separator,{button:0,clientX:300,pointerId:1});
  fireEvent.pointerMove(separator,{clientX:380,pointerId:1});
  fireEvent.pointerUp(separator,{clientX:380,pointerId:1});
  expect(separator).toHaveAttribute('aria-valuenow','300');
  expect(view.container.querySelector('[aria-label="Resource timeline theo ngày"]')).toBeInTheDocument();
});

it('shows monthly allocation donuts for the three primary roles and reports other roles separately',async()=>{
  const makePerson=(id:string,name:string,role:string,allocations:number[],complete=true)=>({...person,person_id:id,name,role,days:person.days.map((day,index)=>({...day,allocated_minutes:allocations[index]??0,remaining_minutes:day.capacity_minutes-(allocations[index]??0),load_complete:complete}))});
  const rows=[makePerson('tech','Nguyen A','TECH',[0,0]),makePerson('supervisor','Supervisor','SUP',[630,630]),makePerson('assistant','Assistant','ASST_SUP',[630,0]),makePerson('engineer','Engineer','CONTROL_RM_ENGINEER',[60,0])];
  await loaded({...snapshot,rows});
  expect(screen.getByRole('article',{name:/Technician · 1 người · Tải 0% · 0 \/ 21 giờ/})).toBeInTheDocument();
  expect(screen.getByRole('article',{name:/Supervisor · 1 người · Tải 100% · 21 \/ 21 giờ/})).toBeInTheDocument();
  expect(screen.getByRole('article',{name:/Assistant Supervisor · 1 người · Tải 50% · 10,5 \/ 21 giờ/})).toBeInTheDocument();
  expect(screen.getByText(/Chức danh khác trong timeline: Control RM Engineer · 1 người · Tải 1 \/ 21 giờ/)).toBeInTheDocument();
  expect(screen.queryByText('Tổng giờ theo craft trong tháng')).not.toBeInTheDocument();
  expect(screen.queryByText(/Roster và phân công theo người/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Onshore test.*Có quyền phân công/)).not.toBeInTheDocument();
});

it('marks incomplete and zero-capacity role loads unavailable instead of showing a zero-percent donut',async()=>{
  const incomplete={...person,person_id:'tech',name:'Nguyen A',role:'TECH',days:person.days.map(day=>({...day,load_complete:false}))};
  const noCapacity={...person,person_id:'supervisor',name:'Supervisor',role:'SUP',days:person.days.map(day=>({...day,capacity_minutes:0,allocated_minutes:0,remaining_minutes:0,load_complete:true}))};
  const view=await loaded({...snapshot,rows:[incomplete,noCapacity]});
  expect(screen.getByRole('article',{name:/Technician · 1 người · Tải chưa xác minh/})).toBeInTheDocument();
  expect(screen.getByRole('article',{name:/Supervisor · 1 người · Không có capacity trong tháng/})).toBeInTheDocument();
  expect(screen.getByRole('article',{name:/Assistant Supervisor · 0 người · Không có người trong nhóm/})).toBeInTheDocument();
  expect(view.container.querySelector('i[data-fill]')).not.toBeInTheDocument();
});

it('caps an over-capacity donut ring while preserving actual percentage and monthly hours',async()=>{
  const over={...person,role:'TECH',days:person.days.map(day=>({...day,allocated_minutes:700,remaining_minutes:-70,load_complete:true}))};
  const view=await loaded({...snapshot,rows:[over]});
  expect(screen.getByRole('article',{name:/Technician · 1 người · Tải 111% · 23,33 \/ 21 giờ · vượt 2,33 giờ/})).toBeInTheDocument();
  expect(view.container.querySelector<HTMLElement>('i[data-fill]')?.style.width).toBe('100%');
  expect(screen.getByText('111%')).toHaveAttribute('data-over','true');
});

it('filters people by name, keeps role totals, and offers today and legend controls',async()=>{
  const second={...person,person_id:'person-2',name:'Tran B',laborcode:'LAB-2'};
  await loaded({...snapshot,rows:[person,second]});
  expect(screen.getByRole('button',{name:'Hôm nay'})).toBeEnabled();
  expect(screen.getByText('Có capacity theo rota')).toBeInTheDocument();
  expect(screen.getByText('Chưa gửi Maximo: mới lưu trong ứng dụng')).toBeInTheDocument();
  expect(screen.getByText('Chờ đối soát: chưa chắc Maximo đã nhận')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Resource timeline'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Tháng sau'})).toBeEnabled();
  expect(screen.getByText(/Nguyen A/)).toBeInTheDocument();
  expect(screen.getByText(/Tran B/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tìm nhân sự'),{target:{value:'lab-2'}});
  expect(screen.queryByText(/Nguyen A/)).not.toBeInTheDocument();
  expect(screen.getByText(/Tran B/)).toBeInTheDocument();
  expect(screen.getByText(/Technician · 2 người/)).toBeInTheDocument();
});

it('loads remaining task summaries only for visible page cards with at most two requests at once',async()=>{
  vi.stubGlobal('IntersectionObserver',TestIntersectionObserver as unknown as typeof IntersectionObserver);
  const orders=Array.from({length:117},(_,index)=>({...workOrder,wonum:`WO-${String(index+1).padStart(3,'0')}`,workorderid:`wo-${index+1}`}));
  const pendingResolvers:Array<(value:unknown)=>void>=[];
  api.tasks.mockImplementation(()=>new Promise(resolve=>pendingResolvers.push(resolve)));
  const view=await loaded(snapshot,orders);
  const observer=TestIntersectionObserver.instances.at(-1)!;
  expect(observer.options.root).toBe(screen.getByLabelText('Danh sách WO hiện tại'));
  expect(view.container.querySelectorAll('button[data-allocation-state]')).toHaveLength(20);
  expect(observer.targets.size).toBe(20);
  observer.trigger('SITE|wo-1');observer.trigger('SITE|wo-2');observer.trigger('SITE|wo-3');
  await waitFor(()=>expect(api.tasks).toHaveBeenCalledTimes(2));
  expect(pendingResolvers).toHaveLength(2);
  pendingResolvers[0]({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[],planning_summary:{state:'partial',remaining_minutes:30,remaining_tasks:1,total_tasks:2,verified_at:new Date(Date.now()).toISOString()}});
  await waitFor(()=>expect(api.tasks).toHaveBeenCalledTimes(3));
  expect(api.orders).toHaveBeenCalledTimes(1);
});

it('cancels a visible-card summary when pagination removes that WO from the current page',async()=>{
  vi.stubGlobal('IntersectionObserver',TestIntersectionObserver as unknown as typeof IntersectionObserver);
  let resolveTask:(value:unknown)=>void=()=>{};
  api.tasks.mockImplementation(()=>new Promise(resolve=>{resolveTask=resolve;}));
  const orders=Array.from({length:25},(_,index)=>({...workOrder,wonum:`WO-${String(index+1).padStart(3,'0')}`,workorderid:`wo-${index+1}`}));
  await loaded(snapshot,orders);
  const observer=TestIntersectionObserver.instances.at(-1)!;
  observer.trigger('SITE|wo-1');
  await waitFor(()=>expect(api.tasks).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button',{name:'Trang sau danh sách WO'}));
  await waitFor(()=>expect(api.tasks.mock.calls[0][4].aborted).toBe(true));
  resolveTask({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[],planning_summary:{state:'partial',remaining_minutes:30,remaining_tasks:1,total_tasks:2,verified_at:new Date(Date.now()).toISOString()}});
  expect(screen.queryByRole('button',{name:/WO-001.*Còn 1 task/})).not.toBeInTheDocument();
  await waitFor(()=>expect(api.orders).toHaveBeenCalledTimes(2));
});

it('aborts visible summary reads when the document hides and ignores a late response',async()=>{
  vi.stubGlobal('IntersectionObserver',TestIntersectionObserver as unknown as typeof IntersectionObserver);
  let resolveTask:(value:unknown)=>void=()=>{};
  api.tasks.mockImplementation(()=>new Promise(resolve=>{resolveTask=resolve;}));
  const view=await loaded();
  TestIntersectionObserver.instances.at(-1)!.trigger('SITE|wo-1');
  await waitFor(()=>expect(api.tasks).toHaveBeenCalledTimes(1));
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  fireEvent(document,new Event('visibilitychange'));
  resolveTask({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[],planning_summary:{state:'partial',remaining_minutes:30,remaining_tasks:1,total_tasks:2,verified_at:new Date(Date.now()).toISOString()}});
  await waitFor(()=>expect(api.tasks.mock.calls[0][4].aborted).toBe(true));
  expect(screen.getByRole('button',{name:/WO-1.*Còn — task · còn — giờ/})).toBeInTheDocument();
  expect(view.container.querySelector('button[data-allocation-state]')).toHaveAttribute('data-allocation-state','unverified');
});

it('offers a targeted retry after a task summary failure without reloading the WO list',async()=>{
  vi.stubGlobal('IntersectionObserver',TestIntersectionObserver as unknown as typeof IntersectionObserver);
  api.tasks.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[],planning_summary:{state:'partial',remaining_minutes:30,remaining_tasks:1,total_tasks:2,verified_at:new Date(Date.now()).toISOString()}});
  const view=await loaded();
  TestIntersectionObserver.instances.at(-1)!.trigger('SITE|wo-1');
  await screen.findByRole('button',{name:'Thử tải lại task'});
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại task'}));
  await screen.findByRole('button',{name:/WO-1.*Còn 1 task · còn 0,5 giờ/});
  expect(api.tasks).toHaveBeenCalledTimes(2);
  expect(api.orders).toHaveBeenCalledTimes(1);
  expect(api.timeline).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector('button[data-allocation-state]')).toHaveAttribute('data-allocation-state','partial');
});

async function longTaskDialog(initial:Snapshot=snapshot,demandHours=20,targetDate='2026-10-05',beforeOpen?:()=>void){
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',upload_enabled:true,tasks:[{task_workorder_id:'task-20',task_id:20,description:'Long repair',planned_labor:[{craft:'E&I',labor_hours:demandHours,quantity:1}],assignments:[{assignment_id:'source-20',task_id:20,craft:'E&I',laborcode:null,scheduledate:null,labor_hours:demandHours,status:'WAITASGN',revision:'1'}]}]});
  const view=await loaded(initial);
  fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
  beforeOpen?.();
  fireEvent.click(screen.getByRole('button',{name:`Thêm phân công cho Nguyen A ngày ${targetDate}`}));
  await screen.findByRole('table',{name:'Bảng phân bổ task theo ngày'});
  return view;
}

it('automatically schedules every selected task in task-id order across the 10.5h daily rota and saves one batch',async()=>{
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',upload_enabled:true,tasks:[10,20].map(taskId=>({task_workorder_id:`task-${taskId}`,task_id:taskId,description:`Repair ${taskId}`,planned_labor:[{craft:'E&I',labor_hours:10,quantity:1}],assignments:[{assignment_id:`source-${taskId}`,task_id:taskId,craft:'E&I',laborcode:null,scheduledate:null,labor_hours:10,status:'WAITASGN',revision:'1'}]}))});
  await loaded({...snapshot,rows:[{...person,days:['2026-10-05','2026-10-06'].map(date=>({...person.days[0],date}))}]});
  fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  await screen.findByRole('table',{name:'Bảng phân bổ task theo ngày'});
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getAllByRole('checkbox').every(box=>(box as HTMLInputElement).checked)).toBe(true);
  expect(screen.getByLabelText('Task 10 giờ ngày 2026-10-05')).toHaveValue(10);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-05')).toHaveValue(0.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-06')).toHaveValue(9.5);
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
  await screen.findByText(/2 task đã được xếp tự động/);
  expect(api.planBatch).toHaveBeenCalledTimes(1);
  const input=api.planBatch.mock.calls[0][1];
  expect(input.tasks).toEqual([
    {task_workorder_id:'task-10',task_id:10,assignment_id:'source-10',total_minutes:600,segments:[{date:'2026-10-05',minutes:600}]},
    {task_workorder_id:'task-20',task_id:20,assignment_id:'source-20',total_minutes:600,segments:[{date:'2026-10-05',minutes:30},{date:'2026-10-06',minutes:570}]},
  ]);
});

it('keeps the task picker and day plan visible together and excludes out-of-scope-only demand',async()=>{
  const scopedTask=(taskId:number,hasOutOfScope=false)=>({task_workorder_id:`task-${taskId}`,task_id:taskId,description:hasOutOfScope?'SHARED TASK DESCRIPTION':`Repair ${taskId}`,planned_labor:[{craft:'E&I',labor_hours:4,quantity:1}],assignments:[{assignment_id:`source-${taskId}`,task_id:taskId,craft:'E&I',laborcode:null,scheduledate:null,labor_hours:4,status:'WAITASGN',revision:'1'}],has_out_of_scope_demand:hasOutOfScope});
  const foreignOnly=[20,30].map(taskId=>({task_workorder_id:`task-${taskId}`,task_id:taskId,description:'FOREIGN PRIVATE DESCRIPTION',planned_labor:[],assignments:[],has_out_of_scope_demand:true}));
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',upload_enabled:true,tasks:[scopedTask(10),...foreignOnly,scopedTask(40,true),scopedTask(50),scopedTask(60)]});
  await loaded({...snapshot,rows:[{...person,days:['2026-10-05','2026-10-06'].map(date=>({...person.days[0],date}))}]});
  fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  const grid=await screen.findByRole('table',{name:'Bảng phân bổ task theo ngày'});
  expect(screen.getByLabelText('Task cần phân công')).toBeInTheDocument();
  expect(grid.closest('[class*="dayPlanPanel"]')).toBeInTheDocument();
  expect(screen.getByText('Task 20, 30 thuộc nhóm khác; không phân công trong E&I.')).toBeInTheDocument();
  expect(screen.getByRole('dialog').textContent).toContain('FOREIGN PRIVATE DESCRIPTION');
  expect(screen.getByRole('dialog').textContent).toContain('SHARED TASK DESCRIPTION');
  expect(screen.getByText(/Chỉ phân công labor E&I; có nhu cầu nhóm khác/)).toBeInTheDocument();
  expect(screen.queryByText(/WO chưa có task/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  expect(screen.getAllByText('Ngoài nhóm E&I · Không thể phân công')).toHaveLength(2);
  expect(screen.getAllByText('FOREIGN PRIVATE DESCRIPTION')).toHaveLength(2);
  expect(screen.getByLabelText('Task 50 giờ ngày 2026-10-05')).toHaveValue(2.5);
  expect(screen.getByLabelText('Task 50 giờ ngày 2026-10-06')).toHaveValue(1.5);
  expect(screen.getByLabelText('Task 60 giờ ngày 2026-10-06')).toHaveValue(4);
  expect(screen.getByRole('button',{name:'Làm mới timeline'})).toBeInTheDocument();
  expect(screen.queryByText(/Chỉ hiển thị nhóm E&I/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
  await screen.findByText(/4 task đã được xếp tự động/);
  expect(api.planBatch).toHaveBeenCalledTimes(1);
  expect(api.planBatch.mock.calls[0][1].tasks.map((task:TestTaskPlanPayload['tasks'][number])=>task.task_id)).toEqual([10,40,50,60]);
});

it('does not offer generic WO hours when Maximo reports only out-of-scope tasks',async()=>{
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',upload_enabled:false,tasks:[{task_workorder_id:'task-20',task_id:20,description:'PRIVATE',planned_labor:[],assignments:[],has_out_of_scope_demand:true}]});
  await loaded();
  fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  await screen.findByText('Task 20 thuộc nhóm khác; không phân công trong E&I.');
  expect(screen.queryByText(/WO chưa có task/)).not.toBeInTheDocument();
  expect(screen.getByRole('dialog').textContent).toContain('PRIVATE');
  expect(screen.getByText('Ngoài nhóm E&I · Không thể phân công')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Giờ Task 20')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Assignment Task 20')).not.toBeInTheDocument();
  expect(screen.queryByRole('row',{name:/Task 20/})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
});

it('automatically extends capacity into the next month until all hours fit',async()=>{
  await longTaskDialog({...snapshot,rows:[{...person,days:[{...person.days[0],date:'2026-10-31'}]}]},20,'2026-10-31',()=>api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>capacityReply(params)));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
  expect(api.timeline).toHaveBeenLastCalledWith('pool-1',expect.objectContaining({date_from:'2026-11-01',date_before:'2026-12-02'}),expect.any(AbortSignal));
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-31')).toHaveValue(10.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-11-01')).toHaveValue(9.5);
});

it('uses only verified remaining rota capacity and skips non-working days',async()=>{
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',upload_enabled:true,tasks:[{task_workorder_id:'task-20',task_id:20,description:'Long repair',planned_labor:[{craft:'E&I',labor_hours:20,quantity:1}],assignments:[{assignment_id:'source-20',task_id:20,craft:'E&I',laborcode:null,scheduledate:null,labor_hours:20,status:'WAITASGN',revision:'1'}]}]});
  const days=[{...person.days[0],allocated_minutes:180,remaining_minutes:450},{...person.days[1],code:'OFF',capacity_minutes:0,remaining_minutes:0},...['2026-10-07','2026-10-08'].map(date=>({...person.days[1],date}))];
  await loaded({...snapshot,rows:[{...person,days}]});
  fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  await screen.findByRole('table',{name:'Bảng phân bổ task theo ngày'});
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-05')).toHaveValue(7.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-07')).toHaveValue(10.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-08')).toHaveValue(2);
  fireEvent.change(screen.getByLabelText('Task 20 giờ ngày 2026-10-07'),{target:{value:'11'}});
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(api.planBatch).not.toHaveBeenCalled();
});

it('recovers an uncertain batch with the same immutable request ID and exact task/date payload',async()=>{
  let saved:TestTaskPlanPayload;
  api.planBatch.mockImplementation(async(_pool:string,input:TestTaskPlanPayload)=>{saved=input;throw new Error('response lost');});
  api.planBatchReceipt.mockImplementation(async(requestId:string)=>{expect(requestId).toBe(saved.request_id);return planBatchResponse(saved);});
  await longTaskDialog();
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
  await screen.findByText(/1 task đã được xếp tự động/);
  expect(api.planBatch).toHaveBeenCalledTimes(1);
  expect(api.planBatchReceipt).toHaveBeenCalledTimes(1);
});

it('keeps selected task demand after a future capacity fetch fails and permits a retry',async()=>{
  await longTaskDialog(snapshot,40,'2026-10-05',()=>api.timeline.mockRejectedValue(new Error('Capacity service failed')));
  await screen.findByText(/Capacity service failed/);
  expect(screen.getByLabelText('Giờ Task 20')).toHaveValue(40);
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>capacityReply(params));
  fireEvent.click(screen.getByRole('button',{name:'Tiếp tục tìm ngày còn capacity'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
  expect(api.planBatch).not.toHaveBeenCalled();
});

it('locks upload and person changes for a reloaded plan even with only one segment left',async()=>{
  const segment={...item,task_id:20,task_workorder_id:'task-20',assignment_id:'source-20',task_description:'Long repair',plan_id:'plan-test',plan_total_minutes:1200,sync_state:'local'};
  await loaded(rowItem(segment));
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',upload_enabled:true,tasks:[]});
  fireEvent.click(screen.getByRole('button',{name:/Phân công Long repair/}));
  await screen.findByText(/Kế hoạch theo ngày đang lưu nội bộ/);
  expect(screen.getByLabelText('Nhân lực phân công')).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Upload assignment lên Maximo'})).not.toBeInTheDocument();
});

it.each(['cancel','escape','edit'])('allows %s after upload preview while preserving the saved plan',async action=>{
  const segment:Assignment={...item,task_id:20,task_workorder_id:'task-20',assignment_id:'source-20',task_description:'Long repair',plan_id:'plan-preview',plan_total_minutes:120,plan_sync_state:'local',sync_state:'local'};
  await loaded(rowItem(segment));
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:true,daily_plan_upload_supported:true,tasks:[]});
  api.planUploadPreview.mockResolvedValue({plan_id:'plan-preview',plan_version:1,preview_token:'token',expires_at:'2099-10-05T05:00:00Z',timezone:grant.timezone,connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',person_id:person.person_id,segments:[{allocation_id:segment.id,date:segment.date,minutes:120,scheduled_start:'2026-10-05T06:30:00+07:00',scheduled_finish:'2026-10-05T08:30:00+07:00'}],total_minutes:120});
  fireEvent.click(screen.getByRole('button',{name:/Phân công Long repair/}));
  fireEvent.click(await screen.findByRole('button',{name:'Xem trước đồng bộ'}));
  await screen.findByRole('button',{name:'Gửi kế hoạch lên Maximo'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy'})).toBeEnabled());
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(screen.getByLabelText('Giờ phân công')).toBeDisabled();
  if(action==='edit'){
    fireEvent.click(screen.getByRole('button',{name:'Chỉnh giờ / Tạo preview mới'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
    expect(screen.getByLabelText('Giờ phân công')).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
  }else if(action==='cancel')fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
  else fireEvent.keyDown(screen.getByRole('button',{name:'Hủy'}),{key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:/Phân công Long repair/})).toBeInTheDocument();
  expect(api.planUpload).not.toHaveBeenCalled();
  expect(api.update).not.toHaveBeenCalled();
  expect(api.remove).not.toHaveBeenCalled();
});

it('keeps plan editor read-only after an unknown upload is reconciled as confirmed',async()=>{
  const segment:Assignment={...item,minutes:120,task_id:20,task_workorder_id:'task-20',assignment_id:'source-20',task_description:'Long repair',plan_id:'plan-confirm',plan_total_minutes:120,plan_version:1,plan_sync_state:'local',sync_state:'local'};
  const synced:Assignment={...segment,remote_assignment_id:'2001',plan_version:2,plan_sync_state:'synced',sync_state:'synced'};
  const makeReceipt=(state:'unknown'|'confirmed',current:Assignment,requestId='plan-request')=>({attempt_id:'plan-attempt',request_id:requestId,plan_id:'plan-confirm',state,mapping:state==='confirmed'?[{allocation_id:segment.id,date:segment.date,assignment_id:'2001'}]:null,items:[current]});
  await loaded(rowItem(segment));
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:true,daily_plan_upload_supported:true,tasks:[]});
  api.planUploadPreview.mockResolvedValue({plan_id:'plan-confirm',plan_version:1,preview_token:'preview-token',expires_at:'2026-10-05T05:00:00Z',timezone:grant.timezone,source_assignment_id:'source-20',connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',task_workorder_id:'task-20',task_id:20,person_id:person.person_id,laborcode:'LAB-1',segments:[{allocation_id:segment.id,version:segment.version,date:segment.date,minutes:segment.minutes,scheduled_start:'2026-10-05T06:30:00+07:00',scheduled_finish:'2026-10-05T08:30:00+07:00',remote_assignment_id:null}],total_minutes:120,can_upload:true,reason:null});
  api.planUpload.mockImplementation(async(_planId:string,requestId:string)=>makeReceipt('unknown',{...segment,plan_sync_state:'unknown',sync_state:'unknown'},requestId));
  api.planUploadStatus.mockImplementation(async()=>makeReceipt('unknown',{...segment,plan_sync_state:'unknown',sync_state:'unknown'}));
  api.planUploadReceipt.mockImplementation(async(requestId:string)=>makeReceipt('unknown',{...segment,plan_sync_state:'unknown',sync_state:'unknown'},requestId));
  api.planUploadReconcile.mockImplementation(async(_attemptId:string,requestId:string)=>makeReceipt('confirmed',synced,requestId));
  fireEvent.click(screen.getByRole('button',{name:/Phân công Long repair/}));
  await screen.findByRole('button',{name:'Xem trước đồng bộ'});
  fireEvent.click(screen.getByRole('button',{name:'Xem trước đồng bộ'}));
  await screen.findByRole('button',{name:'Gửi kế hoạch lên Maximo'});
  fireEvent.click(screen.getByRole('button',{name:'Gửi kế hoạch lên Maximo'}));
  await screen.findByRole('button',{name:'Đối soát (không gửi lại)'});
  expect(screen.getByLabelText('Giờ phân công')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Hủy'})).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('button',{name:'Hủy'}),{key:'Escape'});
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Đối soát (không gửi lại)'}));
  await waitFor(()=>expect(api.planUploadReconcile).toHaveBeenCalledWith('plan-attempt',expect.any(String),'plan-confirm',expect.anything(),expect.any(AbortSignal)));
  await waitFor(()=>expect(screen.getByText(/Đã đồng bộ với Maximo/)).toBeInTheDocument());
  expect(screen.getByRole('heading',{name:'Kế hoạch đã đồng bộ Maximo'})).toBeInTheDocument();
  expect(screen.getAllByText('Đã đồng bộ Maximo').length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('Giờ phân công')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Xóa phân công'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Xác nhận lưu'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Xem trước đồng bộ'})).not.toBeInTheDocument();
});

it('shows a synced multi-day plan with fresh mapped Maximo assignments in the connection timezone',async()=>{
  const first:Assignment={...item,id:'plan-day-1',date:'2026-10-05',minutes:90,task_id:20,task_workorder_id:'task-20',assignment_id:'source-20',task_description:'Long repair',plan_id:'plan-mapped',plan_total_minutes:180,remote_assignment_id:'552349',sync_state:'synced',plan_sync_state:'synced'};
  const second:Assignment={...first,id:'plan-day-2',date:'2026-10-06',minutes:90,remote_assignment_id:'2001472'};
  const receipt={attempt_id:'attempt',request_id:'request',plan_id:'plan-mapped',state:'confirmed' as const,mapping:[{allocation_id:first.id,date:first.date,assignment_id:'552349'},{allocation_id:second.id,date:second.date,assignment_id:'2001472'}],items:[first,second]};
  await loaded({...snapshot,items:[first,second],work_orders:[order]});
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:true,daily_plan_upload_supported:true,tasks:[{task_workorder_id:'task-20',task_id:20,description:'Long repair task',planned_labor:[],assignments:[{assignment_id:'552349',task_id:20,laborcode:'LAB-20',craft:'E&I',scheduledate:'2026-10-05T06:30:00+07:00',labor_hours:1.5,status:'ASSIGNED',revision:'r1'},{assignment_id:'2001472',task_id:20,laborcode:'LAB-20',craft:'E&I',scheduledate:'2026-10-06T07:00:00',labor_hours:1.5,status:'ASSIGNED',revision:'r2'}]}]});
  api.planUploadStatus.mockResolvedValue(receipt);
  fireEvent.click(screen.getAllByRole('button',{name:/Phân công Long repair/})[0]);
  const table=await screen.findByRole('table',{name:'Các ngày Maximo đã đồng bộ'});
  await screen.findByText(/Đủ 2 phân đoạn cho tổng 3 giờ/);
  expect(table).toHaveTextContent('05/10/2026');expect(table).toHaveTextContent('06/10/2026');
  expect(table).toHaveTextContent('552349');expect(table).toHaveTextContent('2001472');
  expect(table).toHaveTextContent('06:30');expect(table).toHaveTextContent('08:00');
  expect(table).not.toHaveTextContent('07:00');expect(table).not.toHaveTextContent('08:30');
  expect(screen.getByText(/Long repair task/)).toBeInTheDocument();expect(screen.getByText(/LAB-20/)).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Xác nhận lưu'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Upload assignment lên Maximo'})).not.toBeInTheDocument();
});

it('caps suggestions at10.5hours before subtracting existing work even if rota offers12hours',async()=>{
  const days=[{...person.days[0],capacity_minutes:720,allocated_minutes:600,remaining_minutes:120},person.days[1],{...person.days[1],date:'2026-10-07'}];
  await longTaskDialog({...snapshot,rows:[{...person,days}]});
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-05')).toHaveValue(0.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-06')).toHaveValue(10.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-07')).toHaveValue(9);
});

it('does not POST when selected days have incomplete load or insufficient remaining capacity',async()=>{
  await longTaskDialog({...snapshot,rows:[{...person,days:[{...person.days[0],load_complete:false},person.days[1]]}]});
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(screen.getByText(/chưa xếp 20h/)).toBeInTheDocument();
  expect(api.plan).not.toHaveBeenCalled();
});


function capacityReply(params:{date_from:string;date_before:string},row=person):Snapshot{
  const days=calendarTestDates(params.date_from,params.date_before).slice(0,-1).map(date=>({...row.days[0],date}));
  return {...snapshot,rows:[{...row,days}]};
}

it.each(['2026-10-31','2026-11-01'])('automatically fetches from chosen start %s and saves exactly the preview',async start=>{
  await longTaskDialog();
  api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>capacityReply(params));
  fireEvent.change(screen.getByLabelText('Ngày bắt đầu'),{target:{value:start}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
  expect(screen.getByLabelText(`Task 20 giờ ngày ${start}`)).toHaveValue(10.5);
  const next=calendarTestDates(start,'2026-11-03')[1];
  expect(screen.getByLabelText(`Task 20 giờ ngày ${next}`)).toHaveValue(9.5);
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
  await screen.findByText(/1 task đã được xếp tự động/);
  expect(api.planBatch.mock.calls[0][1].tasks).toEqual([{task_workorder_id:'task-20',task_id:20,assignment_id:'source-20',total_minutes:1200,segments:[{date:start,minutes:630},{date:next,minutes:570}]}]);
});

it('blocks an empty start without fetching or saving',async()=>{
  await longTaskDialog();
  fireEvent.change(screen.getByLabelText('Ngày bắt đầu'),{target:{value:''}});
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(api.timeline).toHaveBeenCalledTimes(1);
  expect(api.planBatch).not.toHaveBeenCalled();
});

it('uses one task start date in the header, keeps its anchor on person change and refreshes the day preview',async()=>{
  const second={...person,person_id:'person-2',name:'Nguyen B',laborcode:'LAB-2',days:person.days.map(day=>({...day}))};
  await longTaskDialog({...snapshot,rows:[person,second]},12);
  let capacityPerson=person;
  api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>capacityReply(params,capacityPerson));
  const start=screen.getByLabelText('Ngày bắt đầu');
  expect(start).toHaveValue('2026-10-05');
  expect(start).toHaveAttribute('min','2026-10-05');
  expect(start).toHaveAttribute('max','2027-10-05');
  expect(screen.queryByLabelText('Ngày phân công')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Bắt đầu xếp từ ngày')).not.toBeInTheDocument();
  fireEvent.change(start,{target:{value:'2026-10-06'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-06')).toHaveValue(10.5);
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-07')).toHaveValue(1.5);
  expect(screen.getByRole('dialog').textContent).toContain('Nguyen A / 06/10/2026');
  expect(screen.getByRole('columnheader',{name:'06/10/2026'})).toBeInTheDocument();
  capacityPerson=second;
  fireEvent.change(screen.getByLabelText('Nhân lực phân công'),{target:{value:'person-2'}});
  expect(screen.getByLabelText('Ngày bắt đầu')).toHaveValue('2026-10-06');
  await waitFor(()=>expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-06')).toHaveValue(10.5));
});

it('extends demand over several bounded 31-day chunks',async()=>{
  await longTaskDialog(snapshot,360,'2026-10-05',()=>api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>capacityReply(params)));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
  const calls=api.timeline.mock.calls.slice(1);
  expect(calls).toHaveLength(2);
  expect(calls.map(call=>[call[1].date_from,call[1].date_before])).toEqual([['2026-10-07','2026-11-07'],['2026-11-07','2026-12-08']]);
  expect(calls.every(call=>(Date.parse(call[1].date_before)-Date.parse(call[1].date_from))/86400000<=31)).toBe(true);
});

it('blocks the whole preview when the second capacity chunk fails',async()=>{
  let count=0;
  await longTaskDialog(snapshot,360,'2026-10-05',()=>api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>{if(++count===2)throw new Error('Capacity service failed');return capacityReply(params);}));
  await screen.findByText(/Capacity service failed/);
  expect(count).toBe(2);
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(api.planBatch).not.toHaveBeenCalled();
});

it.each(['initial 401','chunk 403','chunk 404','final context change'])('hides scoped workspace after %s during automatic extension',async failure=>{
  await longTaskDialog(snapshot,40,'2026-10-05',()=>{
    if(failure==='initial 401')api.settings.mockRejectedValueOnce(new RetrievalError(401,'Phiên hết hạn'));
    else if(failure==='chunk 403'||failure==='chunk 404')api.timeline.mockRejectedValueOnce(new AssignmentError(failure==='chunk 403'?403:404,'Không còn quyền timeline'));
    else{
      api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>capacityReply(params));
      let check=0;
      api.settings.mockImplementation(async()=>({session:++check===1?session:{...session,user:{...session.user,id:'different-user'}},connections:[{connection_id:'conn',url:'https://example.invalid'}]}));
    }
  }).catch(()=>undefined);
  await screen.findByRole('alert');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/WO-1/})).not.toBeInTheDocument();
  expect(api.planBatch).not.toHaveBeenCalled();
});

it('aborts an old person capacity request and rebuilds for the new person',async()=>{
  const second={...person,person_id:'person-2',name:'Nguyen B',laborcode:'LAB-2',days:[...person.days,{...person.days[1],date:'2026-10-07'},{...person.days[1],date:'2026-10-08'}]};
  let finish!:(value:Snapshot)=>void;let signal:AbortSignal|undefined;
  await longTaskDialog({...snapshot,rows:[person,second]},40,'2026-10-05',()=>api.timeline.mockImplementation((_pool:string,_params:unknown,requestSignal:AbortSignal)=>new Promise(resolve=>{finish=resolve;signal=requestSignal;})));
  await waitFor(()=>expect(finish).toBeDefined());
  fireEvent.change(screen.getByLabelText('Nhân lực phân công'),{target:{value:'person-2'}});
  await waitFor(()=>expect(signal?.aborted).toBe(true));
  finish({...snapshot,rows:[{...person,days:calendarTestDates('2026-10-07','2026-11-06').map(date=>({...person.days[0],date}))}]});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeEnabled());
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-08')).toHaveValue(8.5);
  expect(api.planBatch).not.toHaveBeenCalled();
});

it('freezes demand and source while automatic capacity is loading',async()=>{
  let finish!:(value:Snapshot)=>void;
  await longTaskDialog(snapshot,40,'2026-10-05',()=>api.timeline.mockImplementation(()=>new Promise(resolve=>{finish=resolve;})));
  await waitFor(()=>expect(finish).toBeDefined());
  expect(screen.getByLabelText('Giờ Task 20')).toBeDisabled();
  expect(screen.getByLabelText('Assignment Maximo Task 20')).toHaveTextContent('WAITASGN · E&I · 40h');
  finish(capacityReply({date_from:'2026-10-07',date_before:'2026-11-07'}));
  await waitFor(()=>expect(screen.getByLabelText('Giờ Task 20')).toBeEnabled());
  expect(screen.getByLabelText('Giờ Task 20')).toHaveValue(40);
});

it('rejects negative grid hours and does not extend capacity for manual shortfall',async()=>{
  await longTaskDialog(snapshot,10);
  fireEvent.change(screen.getByLabelText('Task 20 giờ ngày 2026-10-05'),{target:{value:'-0.5'}});
  fireEvent.change(screen.getByLabelText('Task 20 giờ ngày 2026-10-06'),{target:{value:'10.5'}});
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Task 20 giờ ngày 2026-10-05'),{target:{value:'9'}});
  fireEvent.change(screen.getByLabelText('Task 20 giờ ngày 2026-10-06'),{target:{value:''}});
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(api.timeline).toHaveBeenCalledTimes(1);
  expect(api.planBatch).not.toHaveBeenCalled();
});

it('uses fresh roster capacity after deactivation and reactivation',async()=>{
  const view=await longTaskDialog();
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-05')).toHaveValue(10.5);
  const fresh={...snapshot,rows:[{...person,days:person.days.map(day=>({...day,allocated_minutes:600,remaining_minutes:30}))}]};
  api.timeline.mockImplementation(async(_pool:string,params:{date_from:string;date_before:string})=>{if(params.date_from==='2026-10-01')return fresh;throw new Error('future unavailable');});
  view.rerender(<ResourceTimeline active={false}/>);
  view.rerender(<ResourceTimeline active/>);
  await screen.findByText(/future unavailable/);
  expect(screen.getByRole('button',{name:'Xác nhận lưu'})).toBeDisabled();
  expect(screen.getByLabelText('Task 20 giờ ngày 2026-10-05')).not.toHaveValue(10.5);
  expect(api.planBatch).not.toHaveBeenCalled();
});

async function uploadDialog(){
  const taskItem={...item,minutes:30,task_workorder_id:'task-10',task_id:10,assignment_id:'assignment-10',task_description:'Prepare',sync_state:'local'};
  await loaded(rowItem(taskItem));
  api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:true,tasks:[]});
  fireEvent.click(screen.getByRole('button',{name:/Phân công Prepare/}));
  await screen.findByLabelText('Ngày giờ bắt đầu Maximo');
  fireEvent.change(screen.getByLabelText('Ngày giờ bắt đầu Maximo'),{target:{value:'2026-10-05T06:30'}});
}

it('retains unknown upload identity, locks resubmission and reconciles the original attempt',async()=>{
  let requestId='';
  api.upload.mockImplementation(async(_item:Assignment,request:string)=>{requestId=request;return {attempt_id:'attempt-1',allocation_id:item.id,request_id:request,state:'unknown'};});
  api.reconcile.mockImplementation(async()=>({attempt_id:'attempt-1',allocation_id:item.id,request_id:requestId,state:'confirmed'}));
  await uploadDialog();
  fireEvent.click(screen.getByRole('button',{name:'Upload assignment lên Maximo'}));
  await screen.findByRole('button',{name:'Đối soát upload (không gửi lại)'});
  expect(screen.getByRole('button',{name:'Upload assignment lên Maximo'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Hủy'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Upload assignment lên Maximo'}));
  expect(api.upload).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Đối soát upload (không gửi lại)'}));
  await waitFor(()=>expect(api.reconcile).toHaveBeenCalledWith('attempt-1',expect.any(AbortSignal)));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.upload).toHaveBeenCalledTimes(1);
});

it('unlocks a server-confirmed pre-intent rejection without inventing an unknown upload',async()=>{
  const {AssignmentError}=await import('../api/assignments');
  api.upload.mockRejectedValue(new AssignmentError(409,'Remote assignment changed','not_sent'));
  await uploadDialog();
  fireEvent.click(screen.getByRole('button',{name:'Upload assignment lên Maximo'}));
  await screen.findByText('Remote assignment changed');
  expect(screen.getByRole('button',{name:'Hủy'})).toBeEnabled();
  expect(api.uploadReceipt).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Đối soát upload (không gửi lại)'})).not.toBeInTheDocument();
});

it('requires saving changed hours before uploading the persisted task',async()=>{
  await uploadDialog();
  fireEvent.change(screen.getByLabelText('Giờ phân công'),{target:{value:'1'}});
  expect(screen.getByRole('button',{name:'Upload assignment lên Maximo'})).toBeDisabled();
  expect(screen.getByText('Lưu thay đổi phân công trước khi gửi lên Maximo.')).toBeInTheDocument();
});

describe('live Resource timeline interactions', () => {
  it('lets the saved-to-plan notice be dismissed or expire', async () => {
    await loaded();
    dragTo(screen.getByRole('button',{name:/WO-1 · Pump repair/}),screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    await waitLegacyDialog();
    fireEvent.change(screen.getByLabelText('Giờ phân công'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    await screen.findByText(/Phân công đã lưu vào kế hoạch nội bộ/);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(screen.queryByText(/Phân công đã lưu vào kế hoạch nội bộ/)).not.toBeInTheDocument();
  });

  it('creates a scoped reservation by dragging a WO to a person/day cell', async () => {
    await loaded();
    dragTo(screen.getByRole('button',{name:/WO-1 · Pump repair/}),screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitLegacyDialog();
    expect(screen.getByLabelText('Ngày phân công')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Giờ phân công'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    await screen.findByText(/Phân công đã lưu vào kế hoạch nội bộ/);
    expect(api.save).toHaveBeenCalledWith(pool.id, expect.objectContaining({ connection_id: 'conn', discipline: 'E&I', site_id: 'SITE', workorder_id: 'wo-1', person_id: person.person_id, date: '2026-10-05', minutes: 240, request_id: expect.any(String) }), expect.any(AbortSignal));
    expect(api.orders).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:/Còn 1 task · còn 1 giờ/})).toBeInTheDocument();
    expect(screen.getAllByText('4 / 10,5h').length).toBeGreaterThan(0);
    const chip=screen.getByRole('button',{name:/Phân công WO-1 · Pump repair, 4 giờ/});
    fireEvent.click(chip);
    expect(await screen.findByRole('button',{name:'Xóa phân công'})).toBeInTheDocument();
  });

  it('polls the scoped revision without refreshing the WO list, then offers an explicit refresh',async()=>{
    await loaded();
    api.revision.mockResolvedValue({pool_id:pool.id,connection_id:'conn',discipline:'E&I',revision:'r2'});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await screen.findByText(/Phân công đã thay đổi kể từ lần tải này/)).toBeInTheDocument();
    expect(api.orders).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Làm mới dữ liệu'}));
    await waitFor(()=>expect(api.orders).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Phân công đã thay đổi kể từ lần tải này/)).not.toBeInTheDocument();
  });

  it('uses a targeted day read when mutation capacity metadata is missing and marks failed reads unverified',async()=>{
    api.save.mockImplementationOnce(async (_pool:string,input:Record<string,unknown>)=>({...item,...input,id:'new-a',version:1}));
    await loaded();
    api.timeline.mockRejectedValueOnce(new Error('capacity unavailable'));
    fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
    fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    await waitLegacyDialog();
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
    await screen.findByText(/chưa thể làm mới capacity của các ngày bị ảnh hưởng/);
    expect(api.timeline).toHaveBeenCalledTimes(2);
    expect(api.orders).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Tải chưa xác minh').length).toBeGreaterThan(0);
    expect(screen.getByRole('button',{name:/WO-1 · Pump repair.*Còn — task · còn — giờ/})).toBeInTheDocument();
  });

  it('shows fully allocated WOs in Completed only while the server summary is fresh',async()=>{
    const completed={...workOrder,allocation_summary:{state:'completed' as const,remaining_minutes:0,remaining_tasks:0,total_tasks:2,verified_at:'2026-10-01T09:00:00+07:00'}};
    await loaded(snapshot,[completed]);
    expect(screen.queryByRole('button',{name:/WO-1 · Pump repair/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Completed'}));
    expect(await screen.findByRole('button',{name:/WO-1 · Pump repair.*Còn 0 task · còn 0 giờ/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Backlog'}));
    expect(screen.queryByRole('button',{name:/WO-1 · Pump repair/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Completed'}));
    await vi.advanceTimersByTimeAsync(5*60_000);
    await waitFor(()=>expect(screen.queryByRole('button',{name:/WO-1 · Pump repair/})).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Backlog'}));
    expect(await screen.findByRole('button',{name:/WO-1 · Pump repair.*Còn 0 task · còn 0 giờ/})).toBeInTheDocument();
  });

  it('applies a newly verified task summary immediately, even when it arrives after mount',async()=>{
    await loaded();
    api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[],planning_summary:{state:'completed',remaining_minutes:0,remaining_tasks:0,total_tasks:2,verified_at:'2026-10-01T09:00:01+07:00'}});
    await vi.advanceTimersByTimeAsync(1100);
    fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
    fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    await waitFor(()=>expect(api.tasks).toHaveBeenCalled());
    api.orders.mockResolvedValue([{...workOrder,allocation_summary:{state:'completed',remaining_minutes:0,remaining_tasks:0,total_tasks:2,verified_at:'2026-10-01T09:00:01+07:00'}}]);
    fireEvent.click(screen.getByRole('button',{name:'Completed'}));
    expect(await screen.findByRole('button',{name:/WO-1 · Pump repair.*Còn 0 task · còn 0 giờ/})).toBeInTheDocument();
  });

  it('moves a WO back from Completed to Backlog after its confirmed assignment is deleted',async()=>{
    const completedOrder={...workOrder,allocation_summary:{state:'completed' as const,remaining_minutes:0,remaining_tasks:0,total_tasks:1,verified_at:'2026-10-01T09:00:00+07:00'}};
    api.remove.mockResolvedValue({...item,state:'released',version:2,affected_days:[{pool_id:pool.id,person_id:person.person_id,craft:'E&I',laborcode:'LAB-1',date:item.date,code:'D',capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,local_minutes:0,external_minutes:0,synced_minutes:0,load_complete:true}],planning_summary:{state:'unallocated',remaining_minutes:120,remaining_tasks:1,total_tasks:1,verified_at:'2026-10-01T09:00:00+07:00'},assignment_revision:'r2'});
    await loaded(rowItem(item),[completedOrder]);
    fireEvent.click(screen.getByRole('button',{name:'Completed'}));
    expect(await screen.findByRole('button',{name:/WO-1 · Pump repair.*Còn 0 task · còn 0 giờ/})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Phân công WO-1 · Pump repair/}));
    api.orders.mockResolvedValue([{...workOrder,allocation_summary:{state:'unallocated',remaining_minutes:120,remaining_tasks:1,total_tasks:1,verified_at:'2026-10-01T09:00:00+07:00'}}]);
    fireEvent.click(screen.getByRole('button',{name:'Xóa phân công'}));
    await screen.findByText(/Phân công đã lưu vào kế hoạch nội bộ/);
    await waitFor(()=>expect(screen.queryByRole('button',{name:/WO-1 · Pump repair/})).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Backlog'}));
    expect(await screen.findByRole('button',{name:/WO-1 · Pump repair.*Còn 1 task · còn 2 giờ/})).toBeInTheDocument();
  });

  it('loads task detail, selects a WAITASGN row exactly and reserves task hours atomically', async()=>{
    const task={task_workorder_id:'task-wo-10',task_id:10,description:'Replace relay',planned_labor:[{craft:'E&I',labor_hours:'2.5',quantity:'2'}],assignments:[{assignment_id:'as-10',task_id:10,laborcode:null,craft:'E&I',scheduledate:null,labor_hours:'5',status:'WAITASGN',revision:'r1'}]};
    api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[task]});
    api.batch.mockImplementation(async (_pool:string,input:Record<string,unknown>)=>({request_id:input.request_id,items:[{...item,id:'task-a',task_workorder_id:'task-wo-10',task_id:10,assignment_id:'as-10',task_description:'Replace relay',minutes:300}]}));
    await loaded();
    fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
    fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    await screen.findByText(/Replace relay/);
    const taskCard=screen.getByLabelText('Giờ Task 10').closest('article');
    const taskHeader=taskCard?.querySelector('label')?.lastElementChild;
    expect(taskCard?.className).toMatch(/taskCardSelected/);
    expect(taskHeader?.firstElementChild?.textContent).toBe('Task 10');
    expect(taskHeader?.children[1]?.textContent).toBe('Replace relay');
    expect(screen.getByLabelText('Giờ Task 10')).toHaveValue(5);
    expect(screen.getByText('Giờ phân công')).toBeInTheDocument();
    expect(screen.getByText('giờ')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignment Maximo Task 10')).toHaveTextContent('WAITASGN · E&I · 5h');
    expect(screen.queryByLabelText('Assignment Task 10')).not.toBeInTheDocument();
    const save=screen.getByRole('button',{name:'Xác nhận lưu'});
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(()=>expect(api.planBatch).toHaveBeenCalled());
    await screen.findByText(/1 task đã được xếp tự động/);
    expect(api.planBatch).toHaveBeenCalledWith(pool.id,expect.objectContaining({connection_id:'conn',workorder_id:'wo-1',person_id:'person-1',tasks:[{task_workorder_id:'task-wo-10',task_id:10,assignment_id:'as-10',total_minutes:300,segments:[{date:'2026-10-05',minutes:300}]}],request_id:expect.any(String)}),expect.any(AbortSignal));
  });

  it('requires an explicit choice when multiple WAITASGN rows match the task craft',async()=>{
    api.tasks.mockResolvedValue({connection_id:'conn',site_id:'SITE',workorder_id:'wo-1',discipline:'E&I',upload_enabled:false,tasks:[{task_workorder_id:'tw',task_id:20,description:'Test',planned_labor:[{craft:'E&I',labor_hours:'3',quantity:'1'}],assignments:[
      {assignment_id:'as-20a',task_id:20,laborcode:null,craft:'E&I',scheduledate:null,labor_hours:null,status:'WAITASGN',revision:'a'},
      {assignment_id:'as-20b',task_id:20,laborcode:null,craft:'E&I',scheduledate:null,labor_hours:null,status:'WAITASGN',revision:'b'},
    ]}]});
    api.batch.mockImplementation(async (_pool:string,input:Record<string,unknown>)=>({request_id:input.request_id,items:[{...item,id:'task-b',task_workorder_id:'tw',task_id:20,assignment_id:'as-20b',minutes:180}]}));
    await loaded();fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    await screen.findByLabelText('Assignment Task 20');
    const save=screen.getByRole('button',{name:'Xác nhận lưu'});expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Assignment Task 20'),{target:{value:'as-20b'}});expect(save).not.toBeDisabled();fireEvent.click(save);
    await screen.findByText(/1 task đã được xếp tự động/);
    expect(api.planBatch.mock.calls[0][1]).toMatchObject({tasks:[{task_workorder_id:'tw',task_id:20,assignment_id:'as-20b',total_minutes:180,segments:[{date:'2026-10-05',minutes:180}]}]});
  });

  it('moves an assignment between days and edits its minutes from the timeline chip', async () => {
    const firstView = await loaded(rowItem(item));
    const chip = screen.getByRole('button', { name: /Phân công WO-1 · Pump repair, 2 giờ/ });
    dragTo(chip,screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-06'}));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('a-1', expect.objectContaining({ date: '2026-10-06', minutes: 120, version: 1 }), expect.any(AbortSignal)));

    firstView.unmount();
    api.timeline.mockResolvedValue(rowItem(item));
    await loaded(rowItem(item));
    fireEvent.click(screen.getByRole('button', { name: /Phân công WO-1 · Pump repair, 2 giờ/ }));
    fireEvent.change(screen.getByLabelText('Giờ phân công'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('a-1', expect.objectContaining({ date: '2026-10-05', minutes: 180, version: 1 }), expect.any(AbortSignal)));
  });

  it('updates both old and new person-day capacity from the confirmed mutation receipt',async()=>{
    const moved={...item,date:'2026-10-06',version:2};
    api.update.mockResolvedValueOnce({...moved,affected_days:[
      {pool_id:pool.id,person_id:person.person_id,craft:'E&I',laborcode:'LAB-1',date:'2026-10-05',code:'D',capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,local_minutes:0,external_minutes:0,synced_minutes:0,load_complete:true},
      {pool_id:pool.id,person_id:person.person_id,craft:'E&I',laborcode:'LAB-1',date:'2026-10-06',code:'D',capacity_minutes:630,allocated_minutes:120,remaining_minutes:510,local_minutes:120,external_minutes:0,synced_minutes:0,load_complete:true},
    ],planning_summary:{state:'partial',remaining_minutes:60,remaining_tasks:1,total_tasks:2,verified_at:'2026-10-01T09:00:00+07:00'},assignment_revision:'r2'});
    await loaded(rowItem(item));
    fireEvent.click(screen.getByRole('button',{name:/Phân công WO-1 · Pump repair, 2 giờ/}));
    fireEvent.change(screen.getByLabelText('Ngày phân công'),{target:{value:'2026-10-06'}});
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
    await waitFor(()=>expect(api.update).toHaveBeenCalled());
    await waitFor(()=>expect(screen.getAllByText('0 / 10,5h').length).toBeGreaterThan(0));
    expect(screen.getAllByText('2 / 10,5h').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:/Phân công WO-1 · Pump repair, 2 giờ, Nguyen A ngày 2026-10-05/})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:/Phân công WO-1 · Pump repair, 2 giờ, Nguyen A ngày 2026-10-06/})).toBeInTheDocument();
    expect(api.orders).toHaveBeenCalledTimes(1);
  });

  it('releases a reservation and refuses a change that exceeds 10.5 hours', async () => {
    const firstView = await loaded(rowItem(item));
    fireEvent.click(screen.getByRole('button', { name: /Phân công WO-1 · Pump repair, 2 giờ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Xóa phân công' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' }), expect.any(String), expect.any(AbortSignal)));

    firstView.unmount();
    api.save.mockClear();
    const nearFull = { ...person, days: person.days.map(day => day.date === '2026-10-05' ? { ...day, allocated_minutes: 600, remaining_minutes: 30 } : day) };
    await loaded({ ...snapshot, rows: [nearFull] });
    fireEvent.click(screen.getByRole('button', { name: /WO-1 · Pump repair/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm phân công cho Nguyen A ngày 2026-10-05' }));
    await waitLegacyDialog();
    fireEvent.change(screen.getByLabelText('Giờ phân công'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/vượt capacity/);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('fails closed when the session has no unique discipline grant', async () => {
    api.settings.mockResolvedValueOnce({ session: { ...session, preferred_connection_id: null, grants: [grant, { ...grant, discipline: 'MECH' }] }, connections: [] });
    render(<ResourceTimeline />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/discipline duy nhất/);
    expect(api.pools).not.toHaveBeenCalled(); expect(api.orders).not.toHaveBeenCalled();
  });

  it('uses current allocation updates when an immutable create receipt is recovered',async()=>{
    api.save.mockRejectedValueOnce(new Error('response lost'));
    api.lookup.mockResolvedValueOnce({...item,id:'recovered-a',version:1,state:'reserved',allocation_updates:[{...item,id:'recovered-a',version:2,state:'released'}],affected_days:[{pool_id:pool.id,person_id:person.person_id,craft:'E&I',laborcode:'LAB-1',date:item.date,code:'D',capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,local_minutes:0,external_minutes:0,synced_minutes:0,load_complete:true}],planning_summary:{state:'unallocated',remaining_minutes:120,remaining_tasks:1,total_tasks:1,verified_at:'2026-10-01T09:00:00+07:00'},assignment_revision:'r2'});
    await loaded();
    fireEvent.click(screen.getByRole('button',{name:/WO-1 · Pump repair/}));
    fireEvent.click(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
    await waitLegacyDialog();
    fireEvent.change(screen.getByLabelText('Giờ phân công'),{target:{value:'2'}});
    fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu'}));
    await screen.findByText(/Phân công đã lưu vào kế hoạch nội bộ/);
    expect(screen.queryByRole('button',{name:/Phân công WO-1 · Pump repair, 2 giờ/})).not.toBeInTheDocument();
    expect(await screen.findByRole('button',{name:/WO-1 · Pump repair.*Còn 1 task · còn 2 giờ/})).toBeInTheDocument();
  });

  it('keeps the same id and body when retrying an unknown request', async () => {
    await loaded();
    api.save.mockRejectedValueOnce(new Error('connection lost'));
    fireEvent.click(screen.getByRole('button', { name: /WO-1 · Pump repair/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm phân công cho Nguyen A ngày 2026-10-05' }));
    await waitLegacyDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu' }));
    const retry = await screen.findByRole('button', { name: 'Đối soát / gửi lại cùng mã yêu cầu' });
    const first = api.save.mock.calls[0];
    fireEvent.click(screen.getByRole('button',{name:'Đóng hộp thoại để đối soát'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Đối soát / gửi lại cùng mã yêu cầu'})).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(api.save.mock.calls[1][1]).toEqual(first[1]);
  });
});


it('hides cached workforce and assignments immediately on return with expired login', async () => {
  const view = await loaded(rowItem(item));
  view.rerender(<ResourceTimeline active={false} />);
  api.settings.mockRejectedValue(new Error('Phiên đăng nhập đã hết hạn.'));
  view.rerender(<ResourceTimeline active />);
  expect(screen.queryByText('Nguyen A')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(/hết hạn/);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name:/WO-1/})).not.toBeInTheDocument();
});

it('rechecks principal before saving and hides old resources after an identity switch', async () => {
  await loaded();
  fireEvent.click(screen.getByRole('button', {name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button', {name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  await waitLegacyDialog();
  api.settings.mockResolvedValue({session:{...session,user:{...session.user,id:'different-user'}}});
  fireEvent.click(screen.getByRole('button', {name:'Xác nhận lưu'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Phiên, quyền/);
  expect(api.save).not.toHaveBeenCalled();
  expect(screen.queryByText('Nguyen A')).not.toBeInTheDocument();
});

it('does not accept a mismatched receipt after an unknown result', async () => {
  await loaded();
  api.save.mockRejectedValueOnce(new Error('connection lost'));
  api.lookup.mockResolvedValue({...item, minutes:500, date:'2026-10-06'});
  fireEvent.click(screen.getByRole('button', {name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button', {name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  await waitLegacyDialog();
  fireEvent.click(screen.getByRole('button', {name:'Xác nhận lưu'}));
  await screen.findByRole('button', {name:'Đối soát / gửi lại cùng mã yêu cầu'});
  expect(screen.queryByText(/Phân công đã lưu vào kế hoạch nội bộ/)).not.toBeInTheDocument();
  expect(api.save).toHaveBeenCalledTimes(1);
});


it('keeps timeline and proposal intact on window blur/focus without refetching', async () => {
  await loaded();
  fireEvent.click(screen.getByRole('button', {name:/WO-1 · Pump repair/}));
  fireEvent.click(screen.getByRole('button', {name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}));
  const calls = [api.settings.mock.calls.length, api.timeline.mock.calls.length, api.orders.mock.calls.length];
  fireEvent.blur(window); fireEvent.focus(window);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect([api.settings.mock.calls.length, api.timeline.mock.calls.length, api.orders.mock.calls.length]).toEqual(calls);
});

it('checks session on a hidden-tab return without reloading unchanged WO data', async () => {
  await loaded();
  const before = api.settings.mock.calls.length;
  const timelineCalls = api.timeline.mock.calls.length;
  const woCalls = api.orders.mock.calls.length;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(api.settings.mock.calls.length).toBe(before+1));
  await screen.findByText('Nguyen A');
  expect(api.timeline.mock.calls.length).toBe(timelineCalls);
  expect(api.orders.mock.calls.length).toBe(woCalls);
});


it('hides cached data after a denied visible-tab return and can recover on explicit recheck', async () => {
  await loaded();
  api.settings.mockRejectedValue(new Error('Phiên đã hết hạn'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/hết hạn/);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  api.settings.mockResolvedValue({session,connections:[]});
  fireEvent.click(screen.getByRole('button', {name:'Kiểm tra lại quyền và tải'}));
  await screen.findByText('Nguyen A');
  expect(screen.getByRole('table')).toBeInTheDocument();
});


it('does not open an allocation when a pointer drag ends on an off day or is cancelled', async () => {
  await loaded({...snapshot, rows:[{...person,days:[...person.days,{date:'2026-10-07',code:'OFF',capacity_minutes:0,allocated_minutes:0,remaining_minutes:0,local_minutes:0,external_minutes:0,synced_minutes:0,load_complete:true}]}]});
  const source = screen.getByRole('button',{name:/WO-1 · Pump repair/});
  dragTo(source,screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-07'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/không có giờ/);
  fireEvent.pointerDown(source,{button:0,clientX:20,clientY:20,pointerId:1});
  fireEvent.pointerMove(source,{clientX:150,clientY:150,pointerId:1});
  fireEvent.pointerCancel(source,{pointerId:1});
  fireEvent.pointerUp(source,{clientX:150,clientY:150,pointerId:1});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.save).not.toHaveBeenCalled();
});

it('prepares the entire month across 20-row pages and confirms once for every ready plan',async()=>{
  await loaded();
  api.batchLatest.mockRejectedValue(new AssignmentError(404,'No batch'));
  const all=bulkPlanItems(21);let state='previewing';let next:string|null=all[0].item_id;let prepared=0;let creationId='00000000-0000-4000-8000-000000000001';
  api.batchCreate.mockImplementation(async(_pool:string,input:{request_id:string})=>{creationId=input.request_id;return bulkMutation(all,state,next,null,creationId);});
  api.batchGet.mockImplementation(async(_pool:string,_batch:string,_scope:unknown,cursor:string|null)=>({...bulkEnvelope(all,state,next,null,creationId),items:Number(cursor??0)===0?all.slice(0,20):all.slice(20),has_more:Number(cursor??0)===0&&all.length>20,next_cursor:Number(cursor??0)===0&&all.length>20?'20':null}));
  api.batchPrepare.mockImplementation(async()=>{const changed=all[prepared];changed.state='ready';prepared++;next=all[prepared]?.item_id??null;if(prepared===all.length)state='ready';return bulkMutation(all,state,next,changed,creationId);});
  fireEvent.click(screen.getByRole('button',{name:'Đồng bộ Maximo theo tháng'}));
  await screen.findByLabelText('Giờ bắt đầu đồng bộ hàng loạt');
  fireEvent.click(screen.getByRole('button',{name:'Tạo preview tháng'}));
  await screen.findByText('Preview đã sẵn sàng để xác nhận.');
  expect(api.batchPrepare).toHaveBeenCalledTimes(21);
  expect(screen.queryByText(/WO-021/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Trang sau'}));
  expect(await screen.findByText(/WO-021/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Xác nhận 21 mục sẵn sàng'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:/Upload kế hoạch/})).not.toBeInTheDocument();
  expect(api.batchConfirm).not.toHaveBeenCalled();
});

it('continues a confirmed batch through mixed outcomes and offers only no-resend reconciliation for unknown',async()=>{
  const all=bulkPlanItems(3);let state='previewing';let next:string|null=all[0].item_id;let prepared=0;let creationId='00000000-0000-4000-8000-000000000001';const confirmationId='00000000-0000-4000-8000-000000000002';
  const stalePlan={...item,plan_id:all[2].plan_id,plan_total_minutes:all[2].total_minutes,task_workorder_id:all[2].task_workorder_id,task_id:all[2].task_id,assignment_id:all[2].source_assignment_id,sync_state:'local',plan_sync_state:'local'} as Assignment;
  await loaded({...snapshot,items:[stalePlan],work_orders:[order]});
  api.batchLatest.mockRejectedValue(new AssignmentError(404,'No batch'));
  api.batchCreate.mockImplementation(async(_pool:string,input:{request_id:string})=>{creationId=input.request_id;return bulkMutation(all,state,next,null,creationId);});
  mockBulkPages(all,state,next,creationId,confirmationId);
  api.batchPrepare.mockImplementation(async()=>{const changed=all[prepared];changed.state='ready';prepared++;next=all[prepared]?.item_id??null;if(prepared===all.length)state='ready';return bulkMutation(all,state,next,changed,creationId);});
  const outcomes=['confirmed','failed','unknown'];let sent=0;
  api.batchConfirm.mockImplementation(async(_batch:string,requestId:string)=>{state='running';all.forEach(entry=>entry.state='queued');next=all[0].item_id;return bulkMutation(all,state,next,null,creationId,requestId);});
  api.batchContinue.mockImplementation(async(_batch:string,itemId:string)=>{const current=all.find(entry=>entry.item_id===itemId)!;current.state=outcomes[sent++];next=all[sent]?.item_id??null;if(sent===all.length)state='completed';if(current.state==='confirmed'){const syncedConfirmed={...item,id:current.segments[0].allocation_id,minutes:current.total_minutes,date:'2026-10-05',plan_id:current.plan_id,plan_total_minutes:current.total_minutes,task_id:current.task_id,task_workorder_id:current.task_workorder_id,assignment_id:current.source_assignment_id,sync_state:'synced',plan_sync_state:'synced'};current.receipt={attempt_id:'00000000-0000-4000-8000-000000000331',request_id:'00000000-0000-4000-8000-000000000332',plan_id:current.plan_id,state:'confirmed',mapping:null,items:[syncedConfirmed]};}if(current.state==='unknown'){const syncedUnknown={...item,id:current.segments[0].allocation_id,minutes:current.total_minutes,date:'2026-10-05',plan_id:current.plan_id,plan_total_minutes:current.total_minutes,task_id:current.task_id,task_workorder_id:current.task_workorder_id,assignment_id:current.source_assignment_id,sync_state:'unknown',plan_sync_state:'unknown'};current.receipt={attempt_id:'00000000-0000-4000-8000-000000000333',request_id:'00000000-0000-4000-8000-000000000334',plan_id:current.plan_id,state:'unknown',mapping:null,items:[syncedUnknown]};api.planUploadStatus.mockResolvedValue(current.receipt);}return bulkMutation(all,state,next,current,creationId,confirmationId);});
  fireEvent.click(screen.getByRole('button',{name:'Đồng bộ Maximo theo tháng'}));
  await screen.findByLabelText('Giờ bắt đầu đồng bộ hàng loạt');
  fireEvent.click(screen.getByRole('button',{name:'Tạo preview tháng'}));
  await screen.findByText('Preview đã sẵn sàng để xác nhận.');
  let finishCapacity!:(value:Snapshot)=>void;api.timeline.mockImplementationOnce(()=>new Promise(resolve=>{finishCapacity=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận 3 mục sẵn sàng'}));
  await waitFor(()=>expect(api.batchContinue).toHaveBeenCalledTimes(1));
  await waitFor(()=>expect(api.timeline).toHaveBeenCalledTimes(2));
  expect(api.batchContinue).toHaveBeenCalledTimes(1);
  finishCapacity(snapshot);
  await screen.findByText('Batch đã hoàn tất.');
  expect(api.batchConfirm).toHaveBeenCalledTimes(1);
  expect(api.batchContinue).toHaveBeenCalledTimes(3);
  expect(api.batchContinue.mock.calls.map(call=>call[1])).toEqual(all.map(entry=>entry.item_id));
  expect(screen.getByText(/1 \/ 3 kế hoạch đã xác nhận · 0 sẵn sàng · 0 bị chặn · 1 chưa rõ/)).toBeInTheDocument();
  expect(await screen.findByText('Chưa rõ kết quả')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Tạo preview mới'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Mở đối soát (không gửi lại)'}));
  await screen.findByRole('button',{name:'Đối soát (không gửi lại)'});
  expect(api.planUploadStatus).toHaveBeenCalled();expect(api.planUploadPreview).not.toHaveBeenCalled();
  expect(api.batchContinue).toHaveBeenCalledTimes(3);
  expect(api.planUpload).not.toHaveBeenCalled();
});

it('allows a replacement preview after a completed batch with no unknown outcomes',async()=>{
  await loaded();api.batchLatest.mockRejectedValue(new AssignmentError(404,'No batch'));
  const all=bulkPlanItems(1);let state='previewing';let next:string|null=all[0].item_id;let creationId='00000000-0000-4000-8000-000000000001';
  api.batchCreate.mockImplementation(async(_pool:string,input:{request_id:string})=>{creationId=input.request_id;state='previewing';next=all[0].item_id;all[0].state='pending';return bulkMutation(all,state,next,null,creationId);});
  mockBulkPages(all,state,next,creationId);
  api.batchPrepare.mockImplementation(async()=>{all[0].state='ready';state='ready';next=null;return bulkMutation(all,state,next,all[0],creationId);});
  api.batchConfirm.mockImplementation(async(_batch:string,requestId:string)=>{all[0].state='queued';state='running';next=all[0].item_id;return bulkMutation(all,state,next,null,creationId,requestId);});
  api.batchContinue.mockImplementation(async()=>{all[0].state='confirmed';state='completed';next=null;return bulkMutation(all,state,next,all[0],creationId);});
  fireEvent.click(screen.getByRole('button',{name:'Đồng bộ Maximo theo tháng'}));await screen.findByLabelText('Giờ bắt đầu đồng bộ hàng loạt');
  fireEvent.click(screen.getByRole('button',{name:'Tạo preview tháng'}));await screen.findByText('Preview đã sẵn sàng để xác nhận.');
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận 1 mục sẵn sàng'}));await screen.findByText('Batch đã hoàn tất.');
  fireEvent.click(screen.getByRole('button',{name:'Tạo preview mới'}));
  await waitFor(()=>expect(api.batchCreate).toHaveBeenCalledTimes(2));
});

it('does not repeat a lost continue request and keeps sending status read-only',async()=>{
  await loaded();
  api.batchLatest.mockRejectedValue(new AssignmentError(404,'No batch'));
  const all=bulkPlanItems(1);let state='previewing';let next:string|null=all[0].item_id;let creationId='00000000-0000-4000-8000-000000000001';
  api.batchCreate.mockImplementation(async(_pool:string,input:{request_id:string})=>{creationId=input.request_id;return bulkMutation(all,state,next,null,creationId);});
  let reads=0;api.batchGet.mockImplementation(async()=>{reads++;const row={...all[0],state:reads>=3?'sending':all[0].state};return {...bulkEnvelope(all,state,next,null,creationId,'00000000-0000-4000-8000-000000000002'),items:[row],has_more:false,next_cursor:null};});
  api.batchPrepare.mockImplementation(async()=>{all[0].state='ready';state='ready';next=null;return bulkMutation(all,state,next,all[0],creationId);});
  api.batchConfirm.mockImplementation(async(_batch:string,requestId:string)=>{state='running';all[0].state='queued';next=all[0].item_id;return bulkMutation(all,state,next,null,creationId,requestId);});
  api.batchContinue.mockRejectedValue(new Error('connection lost'));
  fireEvent.click(screen.getByRole('button',{name:'Đồng bộ Maximo theo tháng'}));
  await screen.findByLabelText('Giờ bắt đầu đồng bộ hàng loạt');
  fireEvent.click(screen.getByRole('button',{name:'Tạo preview tháng'}));
  await screen.findByText('Preview đã sẵn sàng để xác nhận.');
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận 1 mục sẵn sàng'}));
  await waitFor(()=>expect(api.batchContinue).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Không rõ kết quả gửi một mục/);
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra trạng thái và tiếp tục mục đã xếp hàng'}));
  await waitFor(()=>expect(api.batchGet).toHaveBeenCalled());
  expect(api.batchContinue).toHaveBeenCalledTimes(1);
});

it('does not issue later batch writes after the dialog closes while applying a confirmed receipt',async()=>{
  await loaded();api.batchLatest.mockRejectedValue(new AssignmentError(404,'No batch'));
  const all=bulkPlanItems(2);let state='previewing';let next:string|null=all[0].item_id;let prepared=0;let creationId='00000000-0000-4000-8000-000000000001';const confirmationId='00000000-0000-4000-8000-000000000002';
  api.batchCreate.mockImplementation(async(_pool:string,input:{request_id:string})=>{creationId=input.request_id;return bulkMutation(all,state,next,null,creationId);});
  api.batchGet.mockImplementation(async()=>bulkEnvelope(all,state,next,null,creationId,confirmationId));
  api.batchPrepare.mockImplementation(async()=>{const changed=all[prepared];changed.state='ready';prepared++;next=all[prepared]?.item_id??null;if(prepared===all.length)state='ready';return bulkMutation(all,state,next,changed,creationId);});
  api.batchConfirm.mockImplementation(async(_batch:string,requestId:string)=>{state='running';all.forEach(entry=>entry.state='queued');next=all[0].item_id;return bulkMutation(all,state,next,null,creationId,requestId);});
  let resolveContinue!:(value:unknown)=>void;api.batchContinue.mockImplementation(()=>new Promise(resolve=>{resolveContinue=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'Đồng bộ Maximo theo tháng'}));await screen.findByLabelText('Giờ bắt đầu đồng bộ hàng loạt');fireEvent.click(screen.getByRole('button',{name:'Tạo preview tháng'}));await screen.findByText('Preview đã sẵn sàng để xác nhận.');fireEvent.click(screen.getByRole('button',{name:'Xác nhận 2 mục sẵn sàng'}));await waitFor(()=>expect(api.batchContinue).toHaveBeenCalledTimes(1));
  let finishCapacity!:(value:Snapshot)=>void;api.timeline.mockImplementationOnce(()=>new Promise(resolve=>{finishCapacity=resolve;}));
  const synced={...item,id:all[0].segments[0].allocation_id,minutes:all[0].total_minutes,date:'2026-10-05',plan_id:all[0].plan_id,plan_total_minutes:all[0].total_minutes,task_id:all[0].task_id,task_workorder_id:all[0].task_workorder_id,assignment_id:all[0].source_assignment_id,sync_state:'synced',plan_sync_state:'synced'};
  all[0].state='confirmed';all[0].receipt={attempt_id:'00000000-0000-4000-8000-000000000331',request_id:'00000000-0000-4000-8000-000000000332',plan_id:all[0].plan_id,state:'confirmed',mapping:null,items:[synced]};next=all[1].item_id;
  resolveContinue(bulkMutation(all,'running',next,all[0],creationId,confirmationId));await waitFor(()=>expect(api.timeline).toHaveBeenCalledTimes(2));
  const readsBeforeClose=api.batchGet.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'Đóng'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  finishCapacity(snapshot);await new Promise(resolve=>window.setTimeout(resolve,0));
  expect(api.batchContinue).toHaveBeenCalledTimes(1);expect(api.batchGet).toHaveBeenCalledTimes(readsBeforeClose);
});


function moveIntegrationFixture(){
  const first:Assignment={...item,minutes:60,task_id:20,task_workorder_id:'task-20',assignment_id:'source-20',task_description:'Relocate inspection',plan_id:'move-plan',plan_total_minutes:120,plan_version:1,plan_sync_state:'local',sync_state:'local'};
  const second:Assignment={...first,id:'a-2',date:'2026-10-06'};
  const target={...person,person_id:'person-2',name:'Nguyen B',laborcode:'LAB-2',days:person.days.map(day=>({...day}))};
  const rows=[{...person,days:person.days.map(day=>({...day,allocated_minutes:60,remaining_minutes:570,local_minutes:60}))},target];
  const preview={connection_id:'conn',discipline:'E&I',expected_plan_version:1,anchor_allocation_id:first.id,target_person_id:target.person_id,target_date:first.date,mode:'shift' as const,plan_id:'move-plan',plan_version:1,pool_id:pool.id,task_workorder_id:'task-20',task_id:20,assignment_id:'source-20',source_person_id:person.person_id,source_laborcode:'LAB-1',target_laborcode:'LAB-2',original_demand_minutes:120,total_minutes:120,old_items:[first,second],segments:[{date:first.date,minutes:60},{date:second.date,minutes:60}],capacity:target.days.map(day=>({person_id:target.person_id,date:day.date,laborcode:target.laborcode,capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,proposed_minutes:60,remaining_after_minutes:570}))};
  const reply=(requestId:string,reallocate=false)=>{
    const moved={...first,person_id:target.person_id,laborcode:target.laborcode,minutes:reallocate?120:60,version:2,plan_version:2};
    const next={...second,...(!reallocate?{person_id:target.person_id,laborcode:target.laborcode}:{}),version:2,plan_version:2,state:reallocate?'released' as const:'reserved' as const};
    const affected_days=rows.flatMap(row=>row.days.map(day=>{const minutes=row.person_id===person.person_id?0:reallocate?(day.date===first.date?120:0):60;return {pool_id:pool.id,person_id:row.person_id,craft:row.craft,laborcode:row.laborcode,date:day.date,code:day.code,capacity_minutes:630,allocated_minutes:minutes,remaining_minutes:630-minutes,local_minutes:minutes,external_minutes:0,synced_minutes:0,load_complete:true};}));
    return {request_id:requestId,plan_id:'move-plan',plan_version:2,items:[moved,next],allocation_updates:[moved,next],affected_days,assignment_revision:'r2',previous_assignment_revision:'r1',work_order:order,planning_summary:{state:'completed',remaining_minutes:0,remaining_tasks:0,total_tasks:1,verified_at:'2026-10-01T02:00:00Z'}};
  };
  return {first,second,target,rows,preview,reply};
}

it('moves a whole local plan from a cross-person drag and merges released segments and both capacities',async()=>{
  const f=moveIntegrationFixture();
  await loaded({...snapshot,rows:f.rows,items:[f.first,f.second],work_orders:[order]});
  api.planMovePreview.mockRejectedValueOnce(new AssignmentError(409,'Ngày đích thiếu capacity',undefined,'plan_move_conflict'));
  api.planMovePreview.mockResolvedValueOnce({...f.preview,mode:'reallocate',segments:[{date:f.first.date,minutes:120}],capacity:[{...f.preview.capacity[0],proposed_minutes:120,remaining_after_minutes:510}]});
  api.planMove.mockImplementation(async(_pool:string,_plan:string,input:{request_id:string})=>f.reply(input.request_id,true));
  const source=screen.getAllByRole('button',{name:/Phân công Relocate inspection/})[0];
  dragTo(source,screen.getByRole('button',{name:'Thêm phân công cho Nguyen B ngày 2026-10-05'}));
  await screen.findByRole('heading',{name:'Xem trước chuyển toàn task'});
  expect(screen.getByLabelText('Tháng timeline')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Làm mới timeline'})).toBeDisabled();
  fireEvent.click(await screen.findByRole('button',{name:'Phân bổ lại từ ngày thả'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận chuyển'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận chuyển'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.planMove).toHaveBeenCalledOnce();
  expect(screen.queryAllByRole('button',{name:/Phân công Relocate inspection.*Nguyen A/})).toHaveLength(0);
  const card=screen.getByRole('button',{name:/Phân công Relocate inspection.*2 giờ, Nguyen B/});
  expect(card.closest('td')).toHaveTextContent('2 / 10,5h');
  expect(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-05'}).closest('td')).toHaveTextContent('0 / 10,5h');
  expect(screen.getByRole('button',{name:'Thêm phân công cho Nguyen A ngày 2026-10-06'}).closest('td')).toHaveTextContent('0 / 10,5h');
  expect(api.update).not.toHaveBeenCalled();expect(api.planUpload).not.toHaveBeenCalled();
});

it('recovers a lost move response through the receipt without a second POST',async()=>{
  const f=moveIntegrationFixture();
  await loaded({...snapshot,rows:f.rows,items:[f.first,f.second],work_orders:[order]});
  api.planMovePreview.mockResolvedValue(f.preview);
  api.planMove.mockRejectedValue(new TypeError('response lost'));
  api.planMoveReceipt.mockResolvedValueOnce(null);
  fireEvent.click(screen.getAllByRole('button',{name:/Phân công Relocate inspection/})[0]);
  fireEvent.click(await screen.findByRole('button',{name:'Chuyển task'}));
  fireEvent.change(screen.getByLabelText('Nhân lực đích'),{target:{value:f.target.person_id}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xác nhận chuyển'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận chuyển'}));
  await screen.findByText(/Không gửi lại thao tác chuyển/);
  const input=api.planMove.mock.calls[0][2] as {request_id:string};
  expect(screen.getByText(input.request_id)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Hủy'})).toBeDisabled();
  expect(screen.getByLabelText('Tháng timeline')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Đồng bộ Maximo theo tháng'})).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
  api.planMoveReceipt.mockResolvedValueOnce(f.reply(input.request_id));
  fireEvent.click(screen.getByRole('button',{name:'Đối soát trạng thái chuyển'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.planMove).toHaveBeenCalledOnce();expect(api.planMoveReceipt).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole('button',{name:/Phân công Relocate inspection.*Nguyen B/})).toHaveLength(2);
  expect(screen.queryAllByRole('button',{name:/Phân công Relocate inspection.*Nguyen A/})).toHaveLength(0);
});
