import { afterEach, expect, it, vi } from 'vitest';
import { continueUpload, getDetail, getUploadStatus, listDrafts, listPlannedWorkOrders, lookupUploadRequest, openDraft, previewUpload, reconcileUpload, saveDraft, submitUpload, type Baseline } from './drafts';
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

it('sends a versioned CSRF-protected upload preview and rejects injected fields or a changed draft', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=csrf-value');
  const response = { draft_id: 'draft', version: 3, preview_hash: 'b'.repeat(64), send_enabled: false,
    gate: 'write_contract_unverified', items: [{ site_id: 'SITE', workorder_id: '100', code: 'ready', warnings: [],
      before: { estdur: '8' }, changes: { estdur: '9E+1' } }] };
  const fetcher = respond(response);
  const draft = { draft_id: 'draft', version: 3, state: 'draft' as const };
  const result = await previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal);
  expect(result).toMatchObject({ send_enabled: false, version: 3, items: [{ code: 'ready' }] });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('/api/drafts/draft/upload-preview');
  expect(options).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': 'csrf-value' } });
  expect(JSON.parse(options.body)).toEqual({ version: 3, items: [{ site_id: 'SITE', workorder_id: '100' }] });
  respond({ ...response, items: [{ site_id: 'SITE', workorder_id: '100', code: 'conflict', warnings: [], before: {}, changes: {} }] });
  expect(await previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal)).toMatchObject({ items: [{ code: 'conflict', changes: {} }] });
  respond({ ...response, version: 2 });
  await expect(previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal)).rejects.toThrow();
  respond({ ...response, send_enabled: true });
  await expect(previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal)).rejects.toThrow();
  respond({ ...response, send_enabled: true, gate: null,
    items: [{ ...response.items[0], code: 'conflict', warnings: [], before: {}, changes: {} }] });
  expect(await previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal))
    .toMatchObject({ send_enabled: true, items: [{ code: 'conflict', changes: {} }] });
  respond({ ...response, items: [{ ...response.items[0], site_id: 'OTHER' }] });
  await expect(previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal)).rejects.toThrow();
  respond({ ...response, items: [{ ...response.items[0], changes: { status: 'APPR' }, before: { status: 'WAPPR' } }] });
  await expect(previewUpload(draft, [{ site_id: 'SITE', workorder_id: '100' }], new AbortController().signal)).rejects.toThrow();
});

it('submits only the verified preview with CSRF and validates scoped item status', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=csrf-value');
  const draft = { draft_id: 'draft', version: 3, state: 'draft' as const };
  const preview = { draft_id: 'draft', version: 3, preview_hash: 'b'.repeat(64), send_enabled: true, gate: null,
    items: [{ site_id: 'SITE', workorder_id: '100', code: 'ready' as const, warnings: [], before: { estdur: '8' }, changes: { estdur: '9' } }] };
  const status = { batch_id: 'batch', source_finalized: false, counts: { pending: 1 }, items: [{ item_id: 'item',
    connection_id: 'one', site_id: 'SITE', workorder_id: '100', state: 'pending', updated_at: '2026-10-08T00:00:00Z',
    source: { draft_id: 'draft', draft_version: 3, member_id: 'member' }, duration_result: null, restore_source: null }] };
  const fetcher = respond(status);
  expect(await submitUpload(draft, 'stable-request-id', preview, 'one', new AbortController().signal)).toMatchObject({ batch_id: 'batch' });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('/api/drafts/draft/uploads');
  expect(options).toMatchObject({ method: 'POST', headers: { 'X-CSRF-Token': 'csrf-value' } });
  expect(JSON.parse(options.body)).toEqual({ version: 3, request_id: 'stable-request-id', preview_hash: 'b'.repeat(64),
    items: [{ site_id: 'SITE', workorder_id: '100' }] });
  respond({ ...status, items: [{ ...status.items[0], workorder_id: 'foreign' }] });
  await expect(submitUpload(draft, 'stable-request-id', preview, 'one', new AbortController().signal)).rejects.toThrow();
  respond(status, 503);
  await expect(submitUpload(draft, 'stable-request-id', preview, 'one', new AbortController().signal)).rejects.toThrow('Không hoàn tất yêu cầu');
});

it('accepts only confirmed PM restoration evidence with a complete valid original baseline', async () => {
  const draft = { draft_id: 'draft', version: 3, state: 'draft' as const };
  const selected = [{ site_id: 'SITE', workorder_id: '100' }];
  const before = { worktype: 'PM', schedstart: '2026-10-01T00:00:00Z', schedfinish: '2026-10-02T00:00:00Z',
    assignedtechname: null, estdur: '25', targstartdate: '2026-09-01T00:00:00Z', targcompdate: '2026-10-01T00:00:00Z' };
  const item = { item_id: 'item', connection_id: 'one', site_id: 'SITE', workorder_id: '100', state: 'confirmed', updated_at: '2026-10-08T00:00:00Z',
    source: { draft_id: 'draft', draft_version: 3, member_id: 'member' }, duration_result: null, restore_source: { before } };
  const status = { batch_id: 'batch', source_finalized: true, counts: { confirmed: 1 }, items: [item] };
  respond(status);
  expect(await getUploadStatus('batch', draft, 'one', selected, new AbortController().signal)).toMatchObject({ items: [{ restore_source: { before } }] });
  for (const invalid of [
    { ...item, state: 'unknown' },
    { ...item, restore_source: { before: { ...before, worktype: 'CM' } } },
    { ...item, restore_source: { before: { ...before, schedstart: '2026-10-01' } } },
    { ...item, restore_source: { before: { ...before, estdur: '-1' } } },
    { ...item, restore_source: { before: { ...before, targcompdate: 'invalid' } } },
    { ...item, restore_source: { before: { ...before, targcompdate: undefined } } },
  ]) {
    respond({ ...status, items: [invalid] });
    await expect(getUploadStatus('batch', draft, 'one', selected, new AbortController().signal)).rejects.toThrow();
  }
  const partiallyNull = { ...before, schedstart: null };
  respond({ ...status, items: [{ ...item, restore_source: { before: partiallyNull } }] });
  expect(await getUploadStatus('batch', draft, 'one', selected, new AbortController().signal))
    .toMatchObject({ items: [{ restore_source: { before: partiallyNull } }] });
});

it('parses PM duration warnings per preview row and validates actual duration results without changing item states', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=csrf-value');
  const draft = { draft_id: 'draft', version: 3, state: 'draft' as const };
  const selected = [{ site_id: 'SITE', workorder_id: '100' }, { site_id: 'SITE', workorder_id: '101' }];
  const preview = { draft_id: 'draft', version: 3, preview_hash: 'c'.repeat(64), send_enabled: true, gate: null,
    items: [
      { site_id: 'SITE', workorder_id: '100', code: 'ready', warnings: ['pm_duration_recalculation'], before: { schedstart: '2026-10-01T00:00:00Z' }, changes: { schedstart: '2026-10-02T00:00:00Z' } },
      { site_id: 'SITE', workorder_id: '101', code: 'ready', warnings: [], before: { estdur: '8' }, changes: { estdur: '9' } },
    ] };
  respond(preview);
  expect(await previewUpload(draft, selected, new AbortController().signal)).toMatchObject({
    items: [{ warnings: ['pm_duration_recalculation'] }, { warnings: [] }],
  });
  for (const warnings of [['unknown_warning'], ['pm_duration_recalculation', 'unknown_warning']]) {
    respond({ ...preview, items: [{ ...preview.items[0], warnings }, preview.items[1]] });
    await expect(previewUpload(draft, selected, new AbortController().signal)).rejects.toThrow();
  }

  const status = { batch_id: 'batch', source_finalized: false, counts: { confirmed: 1, unknown: 1 }, items: [
    { item_id: 'one', connection_id: 'one', site_id: 'SITE', workorder_id: '100', state: 'confirmed', updated_at: '2026-10-08T00:00:00Z',
      source: { draft_id: 'draft', draft_version: 3, member_id: 'a' }, duration_result: { code: 'pm_duration_recalculated', expected: '25', actual: '21' }, restore_source: null },
    { item_id: 'two', connection_id: 'one', site_id: 'SITE', workorder_id: '101', state: 'unknown', updated_at: '2026-10-08T00:00:00Z',
      source: { draft_id: 'draft', draft_version: 3, member_id: 'b' }, duration_result: { code: 'pm_duration_mismatch', expected: '8', actual: '9' }, restore_source: null },
  ] };
  respond(status);
  const parsed = await getUploadStatus('batch', draft, 'one', selected, new AbortController().signal);
  expect(parsed.items.map(({ state, duration_result }) => [state, duration_result])).toEqual([
    ['confirmed', { code: 'pm_duration_recalculated', expected: '25', actual: '21' }],
    ['unknown', { code: 'pm_duration_mismatch', expected: '8', actual: '9' }],
  ]);
  respond({ ...status, items: [{ ...status.items[0], duration_result: { code: 'pm_duration_mismatch', expected: '-1', actual: '100001' } }, status.items[1]] });
  await expect(getUploadStatus('batch', draft, 'one', selected, new AbortController().signal)).rejects.toThrow();
  respond({ ...status, counts: { confirmed: 2 }, items: [{ ...status.items[0], duration_result: { code: 'pm_duration_recalculated', expected: '25', actual: '21' } }, { ...status.items[1], state: 'confirmed' }] });
  await expect(getUploadStatus('batch', draft, 'one', selected, new AbortController().signal)).rejects.toThrow();
  respond({ ...status, counts: { unknown: 2 }, items: [{ ...status.items[0], state: 'unknown', duration_result: { code: 'pm_duration_mismatch', expected: null, actual: null } }, status.items[1]] });
  expect(await getUploadStatus('batch', draft, 'one', selected, new AbortController().signal)).toMatchObject({
    items: [{ state: 'unknown', duration_result: { code: 'pm_duration_mismatch', expected: null, actual: null }, restore_source: null }, { state: 'unknown', restore_source: null }],
  });
});

it('sends explicit continuation and reconciliation requests with CSRF and strict status identity', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=csrf-value');
  const draft = { draft_id: 'draft', version: 3, state: 'draft' as const };
  const selected = [{ site_id: 'SITE', workorder_id: '100', code: 'ready' as const, warnings: [] as const, before: { estdur: '8' }, changes: { estdur: '9' } }];
  const status = { batch_id: 'batch', source_finalized: false, counts: { pending: 1 }, items: [{ item_id: 'item',
    connection_id: 'one', site_id: 'SITE', workorder_id: '100', state: 'pending', updated_at: '2026-10-08T00:00:00Z',
    source: { draft_id: 'draft', draft_version: 3, member_id: 'member' }, duration_result: null, restore_source: null }] };
  for (const [fn, suffix] of [[continueUpload, 'continue'], [reconcileUpload, 'reconcile']] as const) {
    const fetcher = respond(status);
    await fn('batch', draft, 'one', selected, new AbortController().signal);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/uploads/batch/${suffix}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'X-CSRF-Token': 'csrf-value' }, body: '{}' });
  }
  respond({ ...status, source_finalized: true });
  await expect(continueUpload('batch', draft, 'one', selected, new AbortController().signal)).rejects.toThrow();
});

it('looks up an uncertain upload by request ID without writing and distinguishes only the allowlisted not-found code', async () => {
  const entry = { request_id: '00000000-0000-4000-8000-000000000001', draft_id: 'draft', version: 3,
    preview_hash: 'b'.repeat(64), connection_id: 'one', discipline: 'MECH', items: [{ site_id: 'SITE', workorder_id: '100' }] };
  const status = { batch_id: 'batch', source_finalized: false, counts: { unknown: 1 }, items: [{ item_id: 'item',
    connection_id: 'one', site_id: 'SITE', workorder_id: '100', state: 'unknown', updated_at: '2026-10-08T00:00:00Z',
    source: { draft_id: 'draft', draft_version: 3, member_id: 'member' }, duration_result: null, restore_source: null }] };
  const fetcher = respond(status);
  expect(await lookupUploadRequest(entry, new AbortController().signal)).toMatchObject({ batch_id: 'batch', counts: { unknown: 1 } });
  expect(fetcher.mock.calls[0][0]).toBe(`/api/uploads/by-request/${entry.request_id}`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
  respond({ detail: { code: 'receipt_not_found', message: 'do not expose this text' } }, 404);
  await expect(lookupUploadRequest(entry, new AbortController().signal)).rejects.toThrow('Chưa tìm thấy kết quả yêu cầu upload');
  respond({ detail: { code: 'scope_denied', message: 'do not expose this text' } }, 404);
  await expect(lookupUploadRequest(entry, new AbortController().signal)).rejects.toThrow('không còn tồn tại hoặc không còn trong quyền truy cập');
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
