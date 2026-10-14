import { afterEach, expect, it, vi } from 'vitest';
import { columns, effectiveAllocationSummary, parseWorkOrder, retrieveWorkOrders, retrieveWorkOrderPage, validateRange, type WorkOrderPageFilter } from './workOrders';

afterEach(() => vi.unstubAllGlobals());
const filter = { connection_id: 'one', discipline: 'E&I', target_from: '2026-09-01T00:00:00+07:00', target_before: '2026-10-01T00:00:00+07:00' };
const row = { ...Object.fromEntries(columns.map(([field]) => [field, null])), siteid: 'SITE',
  wonum: 'WO', workorderid: '1', worktype: 'CM', status: 'APPR', bdpocdiscipline: 'E&I',
  targcompdate: '2026-09-30T00:00:00+07:00', wopriority: null };
const pageFilter:WorkOrderPageFilter={...filter,view:'backlog',search:'pump'};
const pageRows=Array.from({length:20},(_,index)=>({...row,workorderid:String(index+1)}));
const pageBody=(overrides:Record<string,unknown>={})=>({...filter,view:'backlog',search:'pump',count:20,items:pageRows,next_cursor:'opaque-next',has_more:true,total_count:117,page_size:20,filter_revision:'rev-1',snapshot_id:'snapshot-1',expires_at:'2026-10-13T12:00:00Z',...overrides});

it('requests a dense snapshot page and validates cursor, query echo and exact total',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(pageBody())));vi.stubGlobal('fetch',fetcher);
  const page=await retrieveWorkOrderPage(pageFilter,new AbortController().signal);
  const url=new URL(fetcher.mock.calls[0][0],'https://test.example');
  expect(url.pathname).toBe('/api/work-orders/page');
  expect(url.searchParams.get('view')).toBe('backlog');expect(url.searchParams.get('search')).toBe('pump');
  expect(url.searchParams.has('cursor')).toBe(false);expect(page).toMatchObject({next_cursor:'opaque-next',has_more:true,total_count:117,filter_revision:'rev-1',snapshot_id:'snapshot-1'});expect(page.items).toHaveLength(20);expect(page.items[0].wonum).toBe('WO');
  await retrieveWorkOrderPage({...pageFilter,cursor:page.next_cursor!},new AbortController().signal);
  expect(new URL(fetcher.mock.calls[1][0],'https://test.example').searchParams.get('cursor')).toBe('opaque-next');
});

it.each(['scope','query','count','page-size','cursor','total','revision','too-many','duplicate','total-null','sparse','snapshot','expiry'])('rejects malformed paged WO response: %s',async fault=>{
  const items=fault==='duplicate'?pageRows.map((r,index)=>index===1?pageRows[0]:r):fault==='too-many'?Array.from({length:21},(_,index)=>({...row,workorderid:String(index)})):fault==='sparse'?[row]:pageRows;
  const overrides:Record<string,unknown>={items,count:items.length};
  if(fault==='scope')overrides.connection_id='other';if(fault==='query')overrides.search='other';if(fault==='count')overrides.count=99;
  if(fault==='page-size')overrides.page_size=10;if(fault==='cursor')overrides.next_cursor='';if(fault==='total')overrides.total_count=0;
  if(fault==='revision')overrides.filter_revision='';
  if(fault==='total-null')overrides.total_count=null;if(fault==='snapshot')overrides.snapshot_id='';if(fault==='expiry')overrides.expires_at='2026-10-13T12:00:00';
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(pageBody(overrides)))));
  await expect(retrieveWorkOrderPage(pageFilter,new AbortController().signal)).rejects.toThrow();
});

it('sends refresh only for the first page and rejects refresh with a cursor',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(pageBody())));vi.stubGlobal('fetch',fetcher);
  await retrieveWorkOrderPage({...pageFilter,refresh:true},new AbortController().signal);
  expect(new URL(fetcher.mock.calls[0][0],'https://test.example').searchParams.get('refresh')).toBe('true');
  await expect(retrieveWorkOrderPage({...pageFilter,cursor:'old',refresh:true},new AbortController().signal)).rejects.toThrow('Bộ lọc trang');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports a stale paged cursor as a 409 without exposing the response body',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private upstream text',{status:409})));
  await expect(retrieveWorkOrderPage({...pageFilter,cursor:'stale'},new AbortController().signal)).rejects.toMatchObject({status:409,message:'Danh sách Work Order đã thay đổi. Đang tải lại trang đầu.'});
});

it.each(['wrong-scope', 'duplicate', 'missing-field', 'count'])('rejects malformed response: %s', async (fault) => {
  const item = { ...row };
  if (fault === 'missing-field') delete (item as Record<string, unknown>).wonum;
  const items = fault === 'duplicate' ? [item, item] : [item];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    connection_id: fault === 'wrong-scope' ? 'two' : 'one', discipline: 'E&I', items,
    count: fault === 'count' ? 999 : items.length,
  }))));
  await expect(retrieveWorkOrders(filter, new AbortController().signal)).rejects.toThrow();
});

it('encodes filters without losing offset or ampersand and does not expose upstream error body', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('secret upstream details', { status: 502 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(retrieveWorkOrders(filter, new AbortController().signal)).rejects.toThrow('Không lấy được đầy đủ');
  const url = new URL(fetcher.mock.calls[0][0], 'https://test.example');
  expect(url.searchParams.get('discipline')).toBe('E&I');
  expect(url.searchParams.get('target_from')).toBe(filter.target_from);
});

it('requires explicit offset and increasing bounded interval', () => {
  expect(() => validateRange('2026-09-01T00:00', filter.target_before)).toThrow();
  expect(() => validateRange(filter.target_before, filter.target_from)).toThrow();
  expect(() => validateRange(filter.target_from, filter.target_before)).not.toThrow();
});

it('reports deadline expiry without exposing the error body or retrying retrieval', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('sensitive proxy details', { status: 504 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(retrieveWorkOrders(filter, new AbortController().signal)).rejects.toMatchObject({
    status: 504, message: 'Yêu cầu xử lý quá thời gian. Thử thu hẹp khoảng ngày rồi tải lại.',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['duplicate', 'field', 'version', 'timestamp'])('rejects malformed draft markers: %s', async (fault) => {
  const marker = { draft_id: 'id', version: 1, is_batch: false, updated_at: '2026-10-06T00:00:00Z', baseline_changed: false,
    changes: { estdur: '9' } as Record<string, string> };
  if (fault === 'field') marker.changes.status = 'APPR';
  if (fault === 'version') marker.version = 0;
  if (fault === 'timestamp') marker.updated_at = 'invalid';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...filter, count: 1,
    items: [{ ...row, drafts: fault === 'duplicate' ? [marker, marker] : [marker] }] }))));
  await expect(retrieveWorkOrders(filter, new AbortController().signal)).rejects.toThrow('kế hoạch');
});

it.each(['2026-02-30T08:00:00+07:00', '2026-02-29T08:00:00+07:00', '2026-09-31T08:00:00+07:00', '2026-09-01T24:00:00+07:00'])('rejects invalid calendar date %s', (start) => {
  expect(() => validateRange(start, filter.target_before)).toThrow();
});

it('keeps completed allocation status only while its server verification is fresh',()=>{
  const completed={state:'completed',remaining_minutes:0,remaining_tasks:0,total_tasks:2,verified_at:'2026-10-03T10:00:00+07:00'} as const;
  const order=parseWorkOrder({...row,allocation_summary:completed},'E&I');
  expect(effectiveAllocationSummary(order,Date.parse('2026-10-03T10:04:59+07:00')).state).toBe('completed');
  expect(effectiveAllocationSummary(order,Date.parse('2026-10-03T10:05:00+07:00'))).toMatchObject({state:'unverified',remaining_minutes:null,remaining_tasks:null,verified_at:null});
  expect(effectiveAllocationSummary(parseWorkOrder(row,'E&I')).state).toBe('unverified');
});

it('rejects impossible allocation summary counts before filtering WO',()=>{
  expect(()=>parseWorkOrder({...row,allocation_summary:{state:'completed',remaining_minutes:10,remaining_tasks:0,total_tasks:2,verified_at:'2026-10-03T10:00:00+07:00'}},'E&I')).toThrow('Tổng hợp phân bổ WO');
  expect(()=>parseWorkOrder({...row,allocation_summary:{state:'partial',remaining_minutes:-1,remaining_tasks:1,total_tasks:2,verified_at:'2026-10-03T10:00:00+07:00'}},'E&I')).toThrow('Tổng hợp phân bổ WO');
});
