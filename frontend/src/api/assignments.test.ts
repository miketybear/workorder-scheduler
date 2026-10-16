import { afterEach, expect, it, vi } from 'vitest';
import { getAssignmentRevision, getAssignments, getResourceTimeline, getWorkOrderTasks, saveAssignment, saveTaskAllocations, saveTaskPlan, lookupTaskPlanRequest, saveTaskPlanBatch, lookupTaskPlanBatchRequest, uploadAssignment, previewAssignmentPlan, uploadAssignmentPlan, lookupAssignmentPlanUpload, getAssignmentPlanUploadStatus, createPlanUploadBatch, getPlanUploadBatch, getLatestPlanUploadBatch, confirmPlanUploadBatch, continuePlanUploadBatch, previewAssignmentPlanMove, moveAssignmentPlan, lookupAssignmentPlanMoveRequest, type Assignment } from './assignments';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const scope = { connection_id: 'conn', site_id: 'SITE', workorder_id: '123', discipline: 'E&I', date_from: '2026-10-01', date_before: '2026-11-01' };
const item = { id: 'allocation', pool_id: 'pool', ...scope, date_from: undefined, date_before: undefined, person_id: 'person', date: '2026-10-03', minutes: 60, version: 1, state: 'reserved' };

it('reads the selected pool and refuses records outside the requested WO scope', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pool_id: 'pool', pool_version: 2, rows: [], items: [item] })));
  vi.stubGlobal('fetch', fetcher);
  await expect(getAssignments('pool', scope, new AbortController().signal)).resolves.toMatchObject({ pool_id: 'pool', items: [{ workorder_id: '123' }] });
  expect(String(fetcher.mock.calls[0][0])).toContain('workorder_id=123');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ pool_id: 'pool', pool_version: 2, rows: [], items: [{ ...item, workorder_id: '999' }] }))));
  await expect(getAssignments('pool', scope, new AbortController().signal)).rejects.toThrow('ngoài phạm vi');
});

it('sends a scoped reservation with CSRF and pool path, without rota window query fields', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=test');
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(item)));
  vi.stubGlobal('fetch', fetcher);
  await saveAssignment('pool', { connection_id: scope.connection_id, site_id: scope.site_id, workorder_id: scope.workorder_id,
    discipline: scope.discipline, person_id: 'person', date: '2026-10-03', minutes: 60, request_id: '00000000-0000-4000-8000-000000000001' }, new AbortController().signal);
  expect(fetcher.mock.calls[0][0]).toBe('/api/resource-pools/pool/assignments');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('test');
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body).toMatchObject({ connection_id: 'conn', workorder_id: '123', minutes: 60 });
  expect(body).not.toHaveProperty('date_from');
});

it('validates incremental mutation metadata and exposes the opaque scoped revision',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const affected_days=[{pool_id:'pool',person_id:'person',craft:'E&I',laborcode:'L1',date:'2026-10-03',code:'D',capacity_minutes:630,allocated_minutes:60,remaining_minutes:570,local_minutes:60,external_minutes:0,synced_minutes:0,load_complete:true}];
  const summary={state:'partial',remaining_minutes:60,remaining_tasks:1,total_tasks:2,verified_at:'2026-10-03T10:00:00+07:00'};
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({...item,affected_days,planning_summary:summary,assignment_revision:'rev-2'}))).mockResolvedValueOnce(new Response(JSON.stringify({pool_id:'pool',connection_id:'conn',discipline:'E&I',revision:'rev-2'})));
  vi.stubGlobal('fetch',fetcher);
  await expect(saveAssignment('pool',{connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',date:'2026-10-03',minutes:60,request_id:'req'},new AbortController().signal)).resolves.toMatchObject({affected_days,planning_summary:summary,assignment_revision:'rev-2'});
  await expect(getAssignmentRevision('pool','conn','E&I',new AbortController().signal)).resolves.toEqual({pool_id:'pool',connection_id:'conn',discipline:'E&I',revision:'rev-2'});
  const url=new URL(fetcher.mock.calls[1][0],'https://example.test');expect(url.pathname).toBe('/api/resource-pools/pool/assignment-revision');expect(url.searchParams.get('connection_id')).toBe('conn');expect(url.searchParams.get('discipline')).toBe('E&I');
});

it('rejects malformed incremental capacity metadata before exposing a mutation receipt',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...item,affected_days:[{pool_id:'pool',person_id:'person',craft:'E&I',laborcode:'L1',date:'2026-10-03',code:'D',capacity_minutes:630,allocated_minutes:631,remaining_minutes:0,local_minutes:631,external_minutes:0,synced_minutes:0,load_complete:true}]}))));
  await expect(saveAssignment('pool',{connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',date:'2026-10-03',minutes:60,request_id:'req'},new AbortController().signal)).rejects.toThrow('Capacity ngày');
});

it('loads a discipline-scoped monthly resource timeline and rejects cross-discipline assignments', async () => {
  const person = { person_id: 'p1', name: 'Planner', craft: 'E&I', role: 'TECH', laborcode: 'L1', days: [{ date: '2026-10-01', code: 'D', capacity_minutes: 630, allocated_minutes: 0, remaining_minutes: 630,local_minutes:0,external_minutes:0,synced_minutes:0,load_complete:true }] };
  const wo = { connection_id: 'conn', site_id: 'SITE', workorder_id: '123', wonum: 'WO123', description: 'Repair', status: 'WAPPR', eligible: true };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pool_id: 'pool', pool_version: 2, rows: [person], items: [], work_orders: [wo] })));
  vi.stubGlobal('fetch', fetcher);
  const scope = { connection_id: 'conn', discipline: 'E&I', date_from: '2026-10-01', date_before: '2026-11-01' };
  await expect(getResourceTimeline('pool', scope, new AbortController().signal)).resolves.toMatchObject({ rows: [person], work_orders: [wo] });
  expect(String(fetcher.mock.calls[0][0])).toContain('discipline=E%26I');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ pool_id: 'pool', pool_version: 2, rows: [person],
    items: [{ ...item, discipline: 'MECH' }], work_orders: [wo] }))));
  await expect(getResourceTimeline('pool', scope, new AbortController().signal)).rejects.toThrow('ngoài phạm vi');
});

it('keeps overbooked external load visible, including on a zero-capacity day',async()=>{
  const overbooked={person_id:'p1',name:'Worker',craft:'E&I',role:'TECH',laborcode:'L1',days:[
    {date:'2026-10-01',code:'D',capacity_minutes:630,allocated_minutes:720,remaining_minutes:-90,local_minutes:0,external_minutes:720,synced_minutes:0,load_complete:true},
    {date:'2026-10-02',code:'OFF',capacity_minutes:0,allocated_minutes:60,remaining_minutes:-60,local_minutes:0,external_minutes:60,synced_minutes:0,load_complete:true},
  ]};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({pool_id:'pool',pool_version:1,rows:[overbooked],items:[],work_orders:[]}))));
  await expect(getResourceTimeline('pool',scope,new AbortController().signal)).resolves.toMatchObject({rows:[{days:[{remaining_minutes:-90},{remaining_minutes:-60}]}]});
});
it('reads task detail from the scoped route, parses decimal strings and rejects cross task assignment IDs',async()=>{
  const task={task_workorder_id:'528227',task_id:10,description:'Prepare',planned_labor:[{craft:'E&I',labor_hours:'0.5',quantity:'1'}],assignments:[{assignment_id:'535771',task_id:10,laborcode:null,craft:'E&I',scheduledate:null,labor_hours:'0.5',status:'WAITASGN',revision:'7'}],has_out_of_scope_demand:true};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({connection_id:'conn',site_id:'SITE',workorder_id:'123',tasks:[task],upload_enabled:false})));
  vi.stubGlobal('fetch',fetcher);
  await expect(getWorkOrderTasks('conn','SITE','123','E&I',new AbortController().signal)).resolves.toMatchObject({tasks:[{task_id:10,has_out_of_scope_demand:true,planned_labor:[{labor_hours:0.5,quantity:1}],assignments:[{assignment_id:'535771'}]}],upload_enabled:false});
  expect(String(fetcher.mock.calls[0][0])).toContain('/work-orders/conn/SITE/123/tasks?discipline=E%26I');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({connection_id:'conn',site_id:'SITE',workorder_id:'123',tasks:[{...task,assignments:[{...task.assignments[0],task_id:20}]}],upload_enabled:false}))));
  await expect(getWorkOrderTasks('conn','SITE','123','E&I',new AbortController().signal)).rejects.toThrow('task khác');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({connection_id:'conn',site_id:'SITE',workorder_id:'123',tasks:[{...task,has_out_of_scope_demand:'unknown'}],upload_enabled:false}))));
  await expect(getWorkOrderTasks('conn','SITE','123','E&I',new AbortController().signal)).rejects.toThrow('task không hợp lệ');
});

it('posts a task allocation batch as one immutable request and validates the receipt shape',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const input={connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',date:'2026-10-03',request_id:'req-1',tasks:[{task_workorder_id:'task10',task_id:10,assignment_id:'535771',minutes:30}]};
  const saved={...item,id:'task-a',task_workorder_id:'task10',task_id:10,assignment_id:'535771',task_description:'Prepare',minutes:30};
  const metadata={affected_days:[{pool_id:'pool',person_id:'person',craft:'E&I',laborcode:'L1',date:'2026-10-03',code:'D',capacity_minutes:630,allocated_minutes:30,remaining_minutes:600,local_minutes:30,external_minutes:0,synced_minutes:0,load_complete:true}],allocation_updates:[{...saved,version:2,state:'released'}],planning_summary:{state:'partial',remaining_minutes:30,remaining_tasks:1,total_tasks:2,verified_at:'2026-10-03T10:00:00+07:00'},assignment_revision:'r2'};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({request_id:'req-1',items:[saved],...metadata})));
  vi.stubGlobal('fetch',fetcher);
  await expect(saveTaskAllocations('pool',input,new AbortController().signal)).resolves.toMatchObject(JSON.parse(JSON.stringify({request_id:'req-1',items:[{task_id:10,assignment_id:'535771'}],...metadata})));
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/resource-pools/pool/task-allocations');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
  expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('token');
});

it('validates upload attempt identity against the stable request and assignment',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({attempt_id:'attempt-1',allocation_id:item.id,request_id:'req-upload',state:'confirmed'})));
  vi.stubGlobal('fetch',fetcher);
  await expect(uploadAssignment(item as import('./assignments').Assignment,'req-upload','2026-10-03T08:00:00+07:00',new AbortController().signal)).resolves.toMatchObject({request_id:'req-upload',allocation_id:item.id,state:'confirmed'});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({attempt_id:'attempt-1',allocation_id:'other',request_id:'wrong',state:'confirmed'}))));
  await expect(uploadAssignment(item as import('./assignments').Assignment,'req-upload','2026-10-03T08:00:00+07:00',new AbortController().signal)).rejects.toThrow('does not match');
});

it('exposes only explicit server pre-intent rejections as not sent',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:{message:'Assignment changed',outcome:'not_sent',request_id:'req'}}),{status:409})));
  await expect(uploadAssignment(item as import('./assignments').Assignment,'req','2026-10-03T06:30:00+07:00',new AbortController().signal)).rejects.toMatchObject({status:409,outcome:'not_sent'});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Access changed'}),{status:403})));
  await expect(uploadAssignment(item as import('./assignments').Assignment,'req','2026-10-03T06:30:00+07:00',new AbortController().signal)).rejects.toMatchObject({status:403,outcome:undefined});
});

it('marks missing CSRF as known not-sent before fetch',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(uploadAssignment(item as import('./assignments').Assignment,'req','2026-10-03T06:30:00+07:00',new AbortController().signal)).rejects.toMatchObject({status:401,outcome:'not_sent'});
  expect(fetcher).not.toHaveBeenCalled();
});

it('saves a multi-day task plan atomically and validates exact receipt segments',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const input={connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',task_workorder_id:'task-wo',task_id:10,assignment_id:'max-10',total_minutes:1200,request_id:'plan-req',segments:[{date:'2026-10-05',minutes:630},{date:'2026-10-06',minutes:570}]};
  const items=input.segments.map((segment,index)=>({...item,id:`plan-${index}`,task_workorder_id:input.task_workorder_id,task_id:input.task_id,assignment_id:input.assignment_id,plan_id:'plan-1',plan_total_minutes:1200,...segment}));
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({request_id:input.request_id,plan_id:'plan-1',items})));
  vi.stubGlobal('fetch',fetcher);
  await expect(saveTaskPlan('pool',input,new AbortController().signal)).resolves.toMatchObject({request_id:'plan-req',plan_id:'plan-1',items:[{date:'2026-10-05',minutes:630},{date:'2026-10-06',minutes:570}]});
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/resource-pools/pool/task-plans');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
  expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('token');
  const currentUpdate={...items[0],version:2,state:'released'};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({result:{request_id:input.request_id,plan_id:'plan-1',items},allocation_updates:[currentUpdate],assignment_revision:'rev-2'}))));
  await expect(lookupTaskPlanRequest(input.request_id,input,new AbortController().signal)).resolves.toMatchObject({plan_id:'plan-1',items:items.map(segment=>({id:segment.id,date:segment.date,minutes:segment.minutes,plan_id:segment.plan_id})),allocation_updates:[{id:items[0].id,version:2,state:'released'}],assignment_revision:'rev-2'});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({request_id:input.request_id,plan_id:'plan-1',items:[{...items[0],minutes:600},items[1]]}))));
  await expect(saveTaskPlan('pool',input,new AbortController().signal)).rejects.toThrow(/không khớp chính xác/);
});

it('rejects a multi-day plan with duplicate or over-capacity dates before POST',async()=>{
  const input={connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',task_workorder_id:'task-wo',task_id:10,assignment_id:'max-10',total_minutes:700,request_id:'plan-req',segments:[{date:'2026-10-05',minutes:350},{date:'2026-10-05',minutes:350}]};
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(saveTaskPlan('pool',input,new AbortController().signal)).rejects.toThrow(/ngày duy nhất/);
  expect(fetcher).not.toHaveBeenCalled();
});

it('posts one atomic multi-task plan batch and validates each nested plan and receipt',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const input={connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',request_id:'batch-req',tasks:[
    {task_workorder_id:'task10',task_id:10,assignment_id:'max10',total_minutes:600,segments:[{date:'2026-10-01',minutes:600}]},
    {task_workorder_id:'task20',task_id:20,assignment_id:'max20',total_minutes:600,segments:[{date:'2026-10-01',minutes:30},{date:'2026-10-02',minutes:570}]},
  ]};
  const response={request_id:input.request_id,plans:input.tasks.map((task,index)=>({plan_id:`plan-${index}`,...task,items:task.segments.map((segment,segmentIndex)=>({...item,id:`item-${index}-${segmentIndex}`,...segment,workorder_id:'123',task_workorder_id:task.task_workorder_id,task_id:task.task_id,assignment_id:task.assignment_id,plan_id:`plan-${index}`,plan_total_minutes:task.total_minutes}))}))};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal('fetch',fetcher);
  await expect(saveTaskPlanBatch('pool',input,new AbortController().signal)).resolves.toMatchObject({request_id:'batch-req',plans:[{task_id:10,total_minutes:600,items:[{minutes:600}]},{task_id:20,items:[{minutes:30},{minutes:570}]}]});
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/resource-pools/pool/task-plan-batches');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
  expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('token');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({result:response}))));
  await expect(lookupTaskPlanBatchRequest(input.request_id,{...input,request_id:undefined} as never,new AbortController().signal)).resolves.toMatchObject({request_id:'batch-req',plans:[{plan_id:'plan-0'},{plan_id:'plan-1'}]});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...response,plans:[{...response.plans[0],items:[{...response.plans[0].items[0],minutes:599}]},response.plans[1]]}))));
  await expect(saveTaskPlanBatch('pool',input,new AbortController().signal)).rejects.toThrow(/không khớp/);
});

it('rejects duplicate task identities and daily segments over rota before batch POST',async()=>{
  const base={connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',request_id:'batch-req',tasks:[{task_workorder_id:'task10',task_id:10,assignment_id:'max10',total_minutes:700,segments:[{date:'2026-10-01',minutes:631},{date:'2026-10-02',minutes:69}]}]};
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(saveTaskPlanBatch('pool',base,new AbortController().signal)).rejects.toThrow(/giờ khớp/);
  const duplicate={...base,tasks:[...base.tasks,...base.tasks]};
  await expect(saveTaskPlanBatch('pool',duplicate,new AbortController().signal)).rejects.toThrow(/Batch kế hoạch/);
  expect(fetcher).not.toHaveBeenCalled();
});

it('previews a two-day plan, posts one token-bound upload, and validates complete date mapping',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const planItems=[{...item,id:'a1',plan_id:'plan',plan_total_minutes:120,task_workorder_id:'task-wo',task_id:10,assignment_id:'source',date:'2026-10-05',minutes:60,version:3},{...item,id:'a2',plan_id:'plan',plan_total_minutes:120,task_workorder_id:'task-wo',task_id:10,assignment_id:'source',date:'2026-10-06',minutes:60,version:4}];
  const expected={plan_id:'plan',connection_id:'conn',site_id:'SITE',workorder_id:'123',person_id:'person',task_workorder_id:'task-wo',task_id:10,assignment_id:'source',plan_total_minutes:120,segments:planItems.map(({id,date,minutes,version})=>({id,date,minutes,version}))};
  const preview={plan_id:'plan',plan_version:5,preview_token:'00000000-0000-4000-8000-000000000001',expires_at:'2026-10-05T12:02:00+07:00',timezone:'Asia/Bangkok',source_assignment_id:'source',connection_id:'conn',site_id:'SITE',workorder_id:'123',task_workorder_id:'task-wo',task_id:10,person_id:'person',laborcode:'L1',segments:planItems.map((segment,index)=>({allocation_id:segment.id,version:segment.version,date:segment.date,minutes:segment.minutes,scheduled_start:`2026-10-0${5+index}T06:30:00+07:00`,scheduled_finish:`2026-10-0${5+index}T07:30:00+07:00`,remote_assignment_id:index?'2001470':'1968934'})),total_minutes:120,can_upload:true,reason:null};
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(preview)));
  vi.stubGlobal('fetch',fetcher);
  const checked=await previewAssignmentPlan('pool',expected,'06:30',new AbortController().signal);
  expect(checked.segments).toHaveLength(2);expect(String(fetcher.mock.calls[0][0])).toBe('/api/assignment-plans/plan/upload-preview?start_time=06%3A30');
  const receipt={attempt_id:'attempt',request_id:'request',plan_id:'plan',state:'confirmed',mapping:planItems.map((segment,index)=>({allocation_id:segment.id,date:segment.date,assignment_id:index?'2001470':'1968934'}))};
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
  await expect(uploadAssignmentPlan('plan','request',checked,new AbortController().signal)).resolves.toMatchObject({state:'confirmed',mapping:receipt.mapping});
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({request_id:'request',plan_version:5,preview_token:preview.preview_token});
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({...receipt,mapping:receipt.mapping.slice(0,1)})));
  await expect(uploadAssignmentPlan('plan','request',checked,new AbortController().signal)).rejects.toThrow(/bao phủ đúng toàn bộ/);
});

it('refuses a plan preview from another WO and keeps missing receipts unresolved',async()=>{
  const segment={id:'a1',date:'2026-10-05',minutes:60,version:1};const expected={plan_id:'plan',connection_id:'conn',site_id:'SITE',workorder_id:'123',person_id:'person',task_workorder_id:'task-wo',task_id:10,assignment_id:'source',plan_total_minutes:60,segments:[segment]};
  const foreign={plan_id:'plan',plan_version:1,preview_token:'token',expires_at:'2026-10-05T12:02:00Z',timezone:'UTC',source_assignment_id:'source',connection_id:'conn',site_id:'SITE',workorder_id:'999',task_workorder_id:'task-wo',task_id:10,person_id:'person',laborcode:null,segments:[{allocation_id:'a1',version:1,date:'2026-10-05',minutes:60,scheduled_start:'2026-10-05T06:30:00Z',scheduled_finish:'2026-10-05T07:30:00Z',remote_assignment_id:null}],total_minutes:60,can_upload:true,reason:null};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(foreign))));
  await expect(previewAssignmentPlan('pool',expected,'06:30',new AbortController().signal)).rejects.toThrow(/không thuộc phân công hiện tại/);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'not found'}),{status:404})));
  await expect(lookupAssignmentPlanUpload('request','plan',undefined,new AbortController().signal)).resolves.toBeNull();
});

it('accepts a full cross-month server preview when the visible-month slice is a strict subset',async()=>{
  const expected={plan_id:'plan',connection_id:'conn',site_id:'SITE',workorder_id:'123',person_id:'person',task_workorder_id:'task-wo',task_id:10,assignment_id:'source',plan_total_minutes:120,segments:[{id:'a31',date:'2026-10-31',minutes:60,version:2}]};
  const response={plan_id:'plan',plan_version:3,preview_token:'00000000-0000-4000-8000-000000000002',expires_at:'2026-10-30T12:02:00+07:00',timezone:'Asia/Bangkok',source_assignment_id:'source',connection_id:'conn',site_id:'SITE',workorder_id:'123',task_workorder_id:'task-wo',task_id:10,person_id:'person',laborcode:null,segments:[{allocation_id:'a31',version:2,date:'2026-10-31',minutes:60,scheduled_start:'2026-10-31T06:30:00+07:00',scheduled_finish:'2026-10-31T07:30:00+07:00',remote_assignment_id:'source'},{allocation_id:'a01',version:1,date:'2026-11-01',minutes:60,scheduled_start:'2026-11-01T06:30:00+07:00',scheduled_finish:'2026-11-01T07:30:00+07:00',remote_assignment_id:null}],total_minutes:120,can_upload:true,reason:null};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
  await expect(previewAssignmentPlan('pool',expected,'06:30',new AbortController().signal)).resolves.toMatchObject({segments:[{date:'2026-10-31'},{date:'2026-11-01'}],total_minutes:120});
});

it('validates rediscovered plan status against the complete plan scope and mapping',async()=>{
  const source:import('./assignments').Assignment={...item,id:'a1',plan_id:'plan',plan_total_minutes:60,task_workorder_id:'task-wo',task_id:10,assignment_id:'source',date:'2026-10-05',minutes:60,remote_assignment_id:'2001',plan_version:2,plan_sync_state:'synced',state:'reserved'};
  const scope={pool_id:'pool',connection_id:'conn',site_id:'SITE',workorder_id:'123',discipline:'E&I',person_id:'person',task_workorder_id:'task-wo',task_id:10,assignment_id:'source',plan_total_minutes:60,items:[source]};
  const response={attempt_id:'attempt',request_id:'00000000-0000-4000-8000-000000000003',plan_id:'plan',state:'confirmed',mapping:[{allocation_id:'a1',date:'2026-10-05',assignment_id:'2001'}],items:[source]};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
  await expect(getAssignmentPlanUploadStatus('plan',scope,new AbortController().signal)).resolves.toMatchObject({state:'confirmed',items:[{remote_assignment_id:'2001'}]});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...response,items:[{...source,workorder_id:'foreign'}]}))));
  await expect(getAssignmentPlanUploadStatus('plan',scope,new AbortController().signal)).rejects.toThrow(/không khớp đầy đủ kế hoạch/);
});

const bulkScope={pool_id:'pool',connection_id:'conn',discipline:'E&I',month:'2026-10'};
const bulkItem={item_id:'00000000-0000-4000-8000-000000000010',kind:'plan',state:'ready',reason:null,plan_id:'00000000-0000-4000-8000-000000000011',allocation_id:null,connection_id:'conn',site_id:'SITE',workorder_id:'123',wonum:'WO-123',workorder_description:'Pump repair',task_workorder_id:'task-wo',task_id:10,task_description:'Inspect',person_id:'person',person_name:'Planner A',laborcode:'L1',source_assignment_id:'source',plan_version:2,total_minutes:120,segments:[{allocation_id:'00000000-0000-4000-8000-000000000012',version:1,date:'2026-10-31',minutes:60,scheduled_start:'2026-10-31T06:30:00+07:00',scheduled_finish:'2026-10-31T07:30:00+07:00'},{allocation_id:'00000000-0000-4000-8000-000000000013',version:1,date:'2026-11-01',minutes:60,scheduled_start:'2026-11-01T06:30:00+07:00',scheduled_finish:'2026-11-01T07:30:00+07:00'}],attempt_id:null,receipt:null};
function bulkResponse(overrides:Record<string,unknown>={}){return {batch_id:'00000000-0000-4000-8000-000000000020',request_id:'00000000-0000-4000-8000-000000000021',confirmation_request_id:null,pool_id:'pool',connection_id:'conn',discipline:'E&I',month:'2026-10',start_time:'06:30',state:'ready',expires_at:'2026-10-31T08:00:00+07:00',counts:{total:1,pending:0,ready:1,blocked:0,skipped:0,queued:0,sending:0,confirmed:0,failed:0,conflict:0,unknown:0},next_item_id:null,items:[bulkItem],has_more:false,next_cursor:null,changed_item:null,...overrides};}

it('creates a scoped monthly batch and parses cross-month segments without client paging filters',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(bulkResponse({state:'previewing',expires_at:null,counts:{total:1,pending:1,ready:0,blocked:0,skipped:0,queued:0,sending:0,confirmed:0,failed:0,conflict:0,unknown:0},next_item_id:bulkItem.item_id}))));
  vi.stubGlobal('fetch',fetcher);
  const result=await createPlanUploadBatch('pool',{connection_id:'conn',discipline:'E&I',month:'2026-10'},'00000000-0000-4000-8000-000000000021','06:30',new AbortController().signal);
  expect(result.next_item_id).toBe(bulkItem.item_id);
  expect(result.items[0]).toMatchObject({segments:[{date:'2026-10-31'},{date:'2026-11-01'}]});
  expect(fetcher.mock.calls[0][0]).toBe('/api/resource-pools/pool/plan-upload-batches');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({request_id:'00000000-0000-4000-8000-000000000021',month:'2026-10',start_time:'06:30'});
});

it('pages batch preview rows by twenty while the server next item remains global',async()=>{
  const firstItems=Array.from({length:20},(_,index)=>({...bulkItem,item_id:`00000000-0000-4000-8000-${String(index+30).padStart(12,'0')}`,plan_id:`00000000-0000-4000-8000-${String(index+60).padStart(12,'0')}`}));
  const first=bulkResponse({counts:{total:21,pending:0,ready:21,blocked:0,skipped:0,queued:0,sending:0,confirmed:0,failed:0,conflict:0,unknown:0},items:firstItems,has_more:true,next_cursor:'20',next_item_id:'00000000-0000-4000-8000-000000000099'});
  const lastItem={...bulkItem,item_id:'00000000-0000-4000-8000-000000000098'};
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first))).mockResolvedValueOnce(new Response(JSON.stringify(bulkResponse({items:[lastItem],has_more:false,next_cursor:null,next_item_id:'00000000-0000-4000-8000-000000000099',counts:first.counts}))));
  vi.stubGlobal('fetch',fetcher);
  const initial=await getPlanUploadBatch('pool',String(first.batch_id),bulkScope,null,new AbortController().signal);
  const page=await getPlanUploadBatch('pool',String(first.batch_id),bulkScope,initial.next_cursor,new AbortController().signal);
  expect(page.next_item_id).toBe('00000000-0000-4000-8000-000000000099');
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/plan-upload-batches/00000000-0000-4000-8000-000000000020?cursor=0');
  expect(String(fetcher.mock.calls[1][0])).toBe('/api/plan-upload-batches/00000000-0000-4000-8000-000000000020?cursor=20');
});

it('recovers latest batch by month and sends one confirmation or exact queued item request',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const confirmed=bulkResponse({state:'running',confirmation_request_id:'00000000-0000-4000-8000-000000000022',counts:{total:1,pending:0,ready:0,blocked:0,skipped:0,queued:1,sending:0,confirmed:0,failed:0,conflict:0,unknown:0},next_item_id:bulkItem.item_id,items:[{...bulkItem,state:'queued'}]});
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(confirmed)));
  vi.stubGlobal('fetch',fetcher);
  await getLatestPlanUploadBatch('pool',bulkScope,new AbortController().signal);
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/resource-pools/pool/plan-upload-batches?month=2026-10');
  fetcher.mockClear();fetcher.mockResolvedValue(new Response(JSON.stringify(confirmed)));
  await confirmPlanUploadBatch(String(confirmed.batch_id),'00000000-0000-4000-8000-000000000022',bulkScope,new AbortController().signal);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({request_id:'00000000-0000-4000-8000-000000000022'});
  fetcher.mockClear();fetcher.mockResolvedValue(new Response(JSON.stringify(confirmed)));
  await continuePlanUploadBatch(String(confirmed.batch_id),bulkItem.item_id,bulkScope,new AbortController().signal);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({item_id:bulkItem.item_id});
});

it('rejects inconsistent batch status counts and foreign plan scope',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(bulkResponse({pool_id:'foreign'})))));
  await expect(getPlanUploadBatch('pool',bulkResponse().batch_id,bulkScope,null,new AbortController().signal)).rejects.toThrow(/không khớp phạm vi/);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(bulkResponse({counts:{...bulkResponse().counts,confirmed:1}})))));
  await expect(getPlanUploadBatch('pool',bulkResponse().batch_id,bulkScope,null,new AbortController().signal)).rejects.toThrow(/Tổng trạng thái batch/);
});

it('accepts a blocked scoped item without a WO number and fetches the initial page explicitly',async()=>{
  const blocked={...bulkItem,state:'blocked',wonum:null,reason:'missing_task'};
  const body=bulkResponse({items:[blocked],counts:{...bulkResponse().counts,ready:0,blocked:1}});
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch',fetcher);
  const parsed=await getPlanUploadBatch('pool',String(body.batch_id),bulkScope,null,new AbortController().signal);
  expect(parsed.items[0]).toMatchObject({wonum:null,state:'blocked'});
  expect(String(fetcher.mock.calls[0][0])).toContain('?cursor=0');
});

it('accepts a partial reserved timeline for pending demand but requires full minutes once ready',async()=>{
  const partial={...bulkItem,state:'pending',segments:[bulkItem.segments[0]],total_minutes:120};
  const pendingCounts={...bulkResponse().counts,ready:0,pending:1};
  const pending=bulkResponse({state:'previewing',expires_at:null,counts:pendingCounts,next_item_id:partial.item_id,items:[partial]});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(pending))));
  await expect(getPlanUploadBatch('pool',String(pending.batch_id),bulkScope,null,new AbortController().signal)).resolves.toMatchObject({items:[{state:'pending',total_minutes:120,segments:[{minutes:60}]}]});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...pending,state:'ready',counts:{...pendingCounts,pending:0,ready:1},next_item_id:null,items:[{...partial,state:'ready'}]}))));
  await expect(getPlanUploadBatch('pool',String(pending.batch_id),bulkScope,null,new AbortController().signal)).rejects.toThrow(/sai tổng giờ/);
});

it('previews and commits an exact, full-plan move and recovers its durable receipt',async()=>{
  vi.spyOn(document,'cookie','get').mockReturnValue('__Host-wos-csrf=token');
  const source:Assignment={...item,id:'seg-1',date:'2026-10-03',minutes:60,person_id:'person',task_workorder_id:'task-10',task_id:10,assignment_id:'source-10',plan_id:'plan-1',plan_total_minutes:120,plan_version:4,state:'reserved'};
  const source2={...source,id:'seg-2',date:'2026-10-04',minutes:60};
  const input={connection_id:'conn',discipline:'E&I',expected_plan_version:4,anchor_allocation_id:source.id,target_person_id:'person-2',target_date:'2026-10-05',mode:'shift' as const};
  const previewBody={plan_id:'plan-1',plan_version:4,pool_id:'pool',connection_id:'conn',discipline:'E&I',task_workorder_id:'task-10',task_id:10,assignment_id:'source-10',source_person_id:'person',target_person_id:'person-2',source_laborcode:'L1',target_laborcode:'L2',original_demand_minutes:120,total_minutes:120,mode:'shift',old_items:[source,source2],segments:[{date:'2026-10-05',minutes:60},{date:'2026-10-06',minutes:60}],capacity:[{person_id:'person-2',date:'2026-10-05',laborcode:'L2',capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,proposed_minutes:60,remaining_after_minutes:570},{person_id:'person-2',date:'2026-10-06',laborcode:'L2',capacity_minutes:630,allocated_minutes:0,remaining_minutes:630,proposed_minutes:60,remaining_after_minutes:570}],anchor_allocation_id:source.id,target_date:'2026-10-05'};
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(previewBody)));
  vi.stubGlobal('fetch',fetcher);
  const preview=await previewAssignmentPlanMove('pool','plan-1',input,[source],new AbortController().signal);
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/resource-pools/pool/assignment-plans/plan-1/move-preview');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
  expect(preview.old_items).toHaveLength(2);
  const request={...input,request_id:'00000000-0000-4000-8000-000000000011',segments:preview.segments};
  const moved=[{...source,person_id:'person-2',date:'2026-10-05',plan_version:5},{...source2,person_id:'person-2',date:'2026-10-06',plan_version:5}];
  const mutation={request_id:request.request_id,plan_id:'plan-1',plan_version:5,items:moved};
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(mutation)));
  await expect(moveAssignmentPlan('pool','plan-1',request,preview,new AbortController().signal)).resolves.toMatchObject({plan_version:5,items:[{person_id:'person-2'},{person_id:'person-2'}]});
  expect(String(fetcher.mock.calls[1][0])).toBe('/api/resource-pools/pool/assignment-plans/plan-1/move');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(request);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({result:mutation})));
  await expect(lookupAssignmentPlanMoveRequest(request.request_id,'pool','plan-1',request,preview,new AbortController().signal)).resolves.toMatchObject({request_id:request.request_id,items:[{id:'seg-1',person_id:'person-2',date:'2026-10-05'},{id:'seg-2',person_id:'person-2',date:'2026-10-06'}]});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...previewBody,plan_id:'other'}))));
  await expect(previewAssignmentPlanMove('pool','plan-1',input,[source],new AbortController().signal)).rejects.toThrow(/không khớp phạm vi/);
});
