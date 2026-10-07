import { afterEach, expect, it, vi } from 'vitest';
import { getDetail, listDrafts, listPlannedWorkOrders, openDraft, saveDraft, type Baseline } from './drafts';
import { columns } from './workOrders';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const key = { connection_id: 'one', discipline: 'MECH', site_id: 'SITE', workorder_id: '100' };
const baseline: Baseline = { worktype: 'CM', schedstart: null, schedfinish: null,
  assignedtechname: null, estdur: '8', targstartdate: null, targcompdate: '2026-10-01T00:00:00+07:00' };
const item = { ...Object.fromEntries(columns.map(([field]) => [field, null])), ...baseline,
  siteid: 'SITE', workorderid: '100', wonum: 'WO', bdpocdiscipline: 'MECH', status: 'APPR', wopriority: null };
const detail = { connection_id: 'one', item, baseline, baseline_token: 'a'.repeat(64), allowed_pics: ['TECH'] };
function respond(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it.each(['connection', 'site', 'discipline', 'baseline', 'pics', 'token'])('rejects invalid detail boundary: %s', async (fault) => {
  const raw = { ...detail, item: { ...item }, baseline: { ...baseline } };
  if (fault === 'connection') raw.connection_id = 'two';
  if (fault === 'site') raw.item.siteid = 'OTHER';
  if (fault === 'discipline') raw.item.bdpocdiscipline = 'OTHER';
  if (fault === 'baseline') delete (raw.baseline as Record<string, unknown>).estdur;
  if (fault === 'pics') (raw as Record<string, unknown>).allowed_pics = [123];
  if (fault === 'token') raw.baseline_token = 'invalid';
  respond(raw);
  await expect(getDetail(key, new AbortController().signal)).rejects.toThrow();
});

it('validates restored draft identity and owner scope before releasing edits', async () => {
  const restored = { draft_id: 'id', version: 1, state: 'draft', connection_id: 'one', items: [{
    ...detail, discipline: 'OTHER', site_id: 'SITE', workorder_id: '100', changes: { estdur: '9' },
    baseline_changed: false, changes_valid_now: true,
  }] };
  respond(restored);
  await expect(openDraft('id', key, new AbortController().signal)).rejects.toThrow();
  restored.items[0].discipline = 'MECH';
  respond(restored);
  expect(await openDraft('id', key, new AbortController().signal)).toMatchObject({ changes: { estdur: '9' }, version: 1 });
});

it('sends CSRF, request ID, baseline and version for a save and never displays upstream error content', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=csrf-value');
  const fetcher = respond('upstream sensitive content', 409);
  const signal = new AbortController().signal;
  await expect(saveDraft(key, { estdur: '9' }, detail.baseline_token, 'request',
    { draft_id: 'id', version: 2, state: 'draft' }, signal)).rejects.toThrow('WO hoặc nháp đã thay đổi');
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('/api/drafts/id');
  expect(options).toMatchObject({ method: 'PUT', signal, credentials: 'same-origin', cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf-value' } });
  expect(JSON.parse(options.body)).toMatchObject({ ...key, request_id: 'request', baseline_token: detail.baseline_token, version: 2 });
});

it('does not send mutations without CSRF', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
  const fetcher = respond({});
  await expect(saveDraft(key, { estdur: '9' }, detail.baseline_token, 'request', null, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('reads bounded paginated draft summaries and rejects malformed summaries', async () => {
  const fetcher = respond({ items: [{ draft_id: 'id', version: 1, wonum: 'WO', site_id: 'SITE' }], next_offset: 20 });
  expect(await listDrafts(key, 0, new AbortController().signal)).toMatchObject({ next_offset: 20 });
  expect(new URL(fetcher.mock.calls[0][0], 'https://example.invalid').searchParams.get('offset')).toBe('0');
  respond({ items: [{ draft_id: 'id', version: 'bad', wonum: 'WO', site_id: 'SITE' }], next_offset: null });
  await expect(listDrafts(key, 0, new AbortController().signal)).rejects.toThrow();
});

it.each(['valid', 'connection', 'discipline', 'identity', 'field', 'cursor'])('validates the same-table planned WO boundary: %s', async (fault) => {
  const member = { item: { ...item }, site_id: 'SITE', workorder_id: '100', discipline: 'MECH', baseline_changed: false,
    changes: { estdur: '9' } as Record<string, string> };
  const raw = { connection_id: fault === 'connection' ? 'two' : 'one', discipline: 'MECH', next_offset: fault === 'cursor' ? 0 : 20,
    items: [{ draft_id: 'draft', version: 1, updated_at: '2026-10-06T00:00:00Z', items: [member] }] };
  if (fault === 'discipline') member.discipline = 'OTHER';
  if (fault === 'identity') member.site_id = 'OTHER';
  if (fault === 'field') member.changes.status = 'APPR';
  const fetcher = respond(raw);
  const action = listPlannedWorkOrders(key, 0, new AbortController().signal);
  if (fault === 'valid') {
    expect(await action).toMatchObject({ next_offset: 20, items: [{ estdur: '8', drafts: [{ draft_id: 'draft', changes: { estdur: '9' } }] }] });
    expect(new URL(fetcher.mock.calls[0][0], 'https://example.invalid').searchParams.get('include_items')).toBe('true');
  } else await expect(action).rejects.toThrow();
});
