import { afterEach, expect, it, vi } from 'vitest';
import { activateRota, getRotaActivationPreview, type RotaActivationPreview, type RotaActivationReceipt } from './rotaActivation';

afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(document, 'cookie', { configurable:true, value:'' }); });
const setCookie = (value: string) => Object.defineProperty(document, 'cookie', { configurable:true, value });
const snapshot: RotaActivationPreview = {
  import_id:'import-1', pool_id:'pool-1', import_version:4, pool_version:0, policy_version:'v1', coverage_from:'2026-11-01', coverage_before:'2026-12-01',
  can_activate:true, blocking_reasons:[], diff:{ added_people:1, removed_people:0, changed_people:0, changed_days:31, before_hours:0, after_hours:325.5 },
  changes:[{ person_key:'person-1', name:'Nguyen Van A', change_type:'added', before_crafts:[], after_crafts:['E&I'], before_roles:[], after_roles:['TECH'], before_hours:0, after_hours:325.5, changed_days:31, day_changes:[{ date:'2026-11-01', before:null, after:{ code:'W', capacity_hours:10.5, craft:'E&I', role:'TECH' } }], day_changes_truncated:true }], activation_receipt:null,
};
const receipt: RotaActivationReceipt = { id:'receipt-1', pool_id:'pool-1', import_id:'import-1', import_version:4, pool_version:1, coverage_from:'2026-11-01', coverage_before:'2026-12-01', activated_at:'2026-10-11T08:00:00Z', person_count:1, day_count:31, total_hours:325.5 };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers:{ 'Content-Type':'application/json' } });

it('fetches a validated pool-bound activation diff, including durable receipt status', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(snapshot)); vi.stubGlobal('fetch', fetcher);
  expect(await getRotaActivationPreview('import-1', 'pool-1', new AbortController().signal)).toEqual(snapshot);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials:'same-origin', cache:'no-store' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...snapshot, pool_id:'wrong-pool' })));
  await expect(getRotaActivationPreview('import-1', 'pool-2', new AbortController().signal)).rejects.toThrow(/khác/);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...snapshot, activation_receipt:receipt })));
  expect((await getRotaActivationPreview('import-1', 'pool-1', new AbortController().signal)).activation_receipt).toEqual(receipt);
});

it('posts confirmation with CSRF and exact import/pool versions, then validates receipt identity', async () => {
  setCookie('__Host-wos-csrf=csrf-token');
  const fetcher = vi.fn().mockResolvedValue(response(receipt)); vi.stubGlobal('fetch', fetcher);
  expect(await activateRota(snapshot, true, new AbortController().signal)).toEqual(receipt);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toContain('/rota-imports/import-1/activate');
  expect(init.headers.get('X-CSRF-Token')).toBe('csrf-token');
  expect(JSON.parse(init.body)).toEqual({ version:4, pool_version:0, confirm_full_replacement:true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...receipt, pool_id:'wrong-pool' })));
  await expect(activateRota(snapshot, true, new AbortController().signal)).rejects.toThrow(/không khớp/);
});

it('requires CSRF and treats stale versions as explicit conflicts', async () => {
  setCookie('');
  await expect(activateRota(snapshot, true, new AbortController().signal)).rejects.toMatchObject({ status:401 });
  setCookie('__Host-wos-csrf=csrf-token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream detail', { status:409 })));
  await expect(activateRota(snapshot, true, new AbortController().signal)).rejects.toMatchObject({ status:409, message:expect.stringMatching(/thay đổi/) });
});
