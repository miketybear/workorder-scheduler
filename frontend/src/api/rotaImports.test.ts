import { afterEach, expect, it, vi } from 'vitest';
import { cancelRotaImport, getRotaImport, listResourcePools, parseRotaPreview, updateRotaMapping, uploadRotaImport, type RotaPreview } from './rotaImports';

afterEach(() => { vi.unstubAllGlobals(); delete (document as unknown as { cookie?: string }).cookie; });
const setCookie = (value: string) => Object.defineProperty(document, 'cookie', { configurable:true, value });
const pool = { id:'pool-1', label:'Rota Onshore', connection_id:'connection-1', connection_label:'Onshore Test', environment:'test', orgid:'BDPOC', timezone:'Asia/Ho_Chi_Minh', capability:'write' };
const labor = { labor_key:'connection-1:BDPOC:LAB01', connection_id:'connection-1', orgid:'BDPOC', laborcode:'LAB01', personid:'PERSON1', displayname:'Nguyen Van A', default_crafts:['E&I'] };
const preview: RotaPreview = {
  id:'import-1', pool_id:'pool-1', version:1, status:'staged', file_name:'rota.xlsx', sheet:'ROTA_2026', created_at:'2026-10-11T01:00:00Z', coverage_from:'2026-11-01', coverage_before:'2026-12-01',
  policy_version:'v1', labor_snapshot_at:'2026-10-11T01:00:00Z', labor_error:null, excluded_labor_count:0, source_errors:[],
  rows:[{ source_row:10, name:'Nguyen Van A', position:'E&I technician', craft:'E&I', role:'TECH', days:[{ date:'2026-11-01', code:'W', capacity_hours:10.5 }], mapping:labor, candidates:[labor], issues:[]}],
  summary:{ rota_people:1, mapped_people:1, blocking_count:0, capacity_hours:10.5 },
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers:{'Content-Type':'application/json'} });

it('sends selected spreadsheet as raw bytes with encoded file and sheet query', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(preview)); vi.stubGlobal('fetch', fetcher);
  setCookie('__Host-wos-csrf=token');
  const file = new File(['ods-bytes'], 'Rota & plan.ods', { type:'application/vnd.oasis.opendocument.spreadsheet' });
  await uploadRotaImport('pool-1', file, 'ROTA 2026', new AbortController().signal);
  const [url, init] = fetcher.mock.calls[0];
  const parsed = new URL(url, 'https://app.example');
  expect(parsed.searchParams.get('filename')).toBe('Rota & plan.ods');
  expect(parsed.searchParams.get('sheet')).toBe('ROTA 2026');
  expect(init.method).toBe('POST'); expect(init.headers.get('Content-Type')).toBe('application/octet-stream');
  expect(init.body).toBe(file); expect(init.credentials).toBe('same-origin'); expect(init.cache).toBe('no-store');
});

it('requires CSRF for mapping, refresh and cancel mutations', async () => {
  const fetcher = vi.fn().mockImplementation(() => response(preview)); vi.stubGlobal('fetch', fetcher);
  setCookie('');
  await expect(updateRotaMapping(preview, 10, labor.labor_key, new AbortController().signal)).rejects.toMatchObject({ status:401 });
  setCookie('__Host-wos-csrf=token%2Bvalue');
  const signal = new AbortController().signal;
  await updateRotaMapping(preview, 10, null, signal);
  await cancelRotaImport(preview, signal);
  expect(fetcher.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('token+value');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ version:1, source_row:10, labor_key:null });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ version:1 });
});

it('rejects malformed DTOs and cross-pool import responses', async () => {
  expect(() => parseRotaPreview({ ...preview, rows:[{ ...preview.rows[0], mapping:labor, candidates:[] }] })).toThrow();
  const fetcher = vi.fn().mockResolvedValue(response({ items:[pool, pool] })); vi.stubGlobal('fetch', fetcher);
  await expect(listResourcePools(new AbortController().signal)).rejects.toThrow(/trùng/);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...preview, pool_id:'different' })));
  await expect(getRotaImport(preview.id, preview.pool_id, new AbortController().signal)).rejects.toThrow(/khác/);
});

it('preserves invalid source rows with an empty position so the planner can see parser issues', () => {
  const invalidRow = { ...preview.rows[0], position:'', craft:null, role:null, mapping:null, candidates:[],
    issues:[{ kind:'missing-position', message:'Thiếu chức danh nguồn.', source_row:10, date:null, cell:'C10' }] };
  const parsed = parseRotaPreview({ ...preview, rows:[invalidRow], summary:{ ...preview.summary, mapped_people:0, blocking_count:1, capacity_hours:0 } });
  expect(parsed.rows[0].position).toBe('');
  expect(parsed.rows[0].issues[0].cell).toBe('C10');
});

it('does not include upstream body in a stale version error', async () => {
  setCookie('__Host-wos-csrf=token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret maximo token', { status:409 })));
  await expect(cancelRotaImport(preview, new AbortController().signal)).rejects.toMatchObject({ status:409, message:expect.stringMatching(/cập nhật/) });
  await expect(cancelRotaImport(preview, new AbortController().signal)).rejects.not.toThrow('secret');
});

it('preserves PERSON.title and excluded positions and rejects malformed diagnostic fields', () => {
  const titled = { ...labor, title: 'E&I Technician' };
  const exclusion = { source_row: 96, name: 'Nguyen Manh Hung', position: 'Material controller' };
  const body = { ...preview, rows: [{ ...preview.rows[0], mapping: titled, candidates: [titled] }], excluded_position_count: 1, excluded_positions: [exclusion] };
  const parsed = parseRotaPreview(body);
  expect(parsed.rows[0].mapping?.title).toBe('E&I Technician');
  expect(parsed.excluded_positions).toEqual([exclusion]);
  expect(() => parseRotaPreview({ ...body, excluded_position_count: 2 })).toThrow();
  expect(() => parseRotaPreview({ ...body, rows: [{ ...body.rows[0], candidates: [{ ...titled, title: 12 }] }] })).toThrow();
  expect(parseRotaPreview(preview).rows[0].mapping?.title).toBeUndefined();
});
