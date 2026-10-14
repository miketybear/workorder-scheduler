import { afterEach, expect, it, vi } from 'vitest';
import { getAssignmentRevision, getAssignments, getResourceTimeline, getWorkOrderTasks, saveAssignment, saveTaskAllocations, saveTaskPlan, lookupTaskPlanRequest, saveTaskPlanBatch, lookupTaskPlanBatchRequest, uploadAssignment } from './assignments';

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
