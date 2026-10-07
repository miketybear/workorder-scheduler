import { afterEach, expect, it, vi } from 'vitest';
import { columns, retrieveWorkOrders, validateRange } from './workOrders';

afterEach(() => vi.unstubAllGlobals());
const filter = { connection_id: 'one', discipline: 'E&I', target_from: '2026-09-01T00:00:00+07:00', target_before: '2026-10-01T00:00:00+07:00' };
const row = { ...Object.fromEntries(columns.map(([field]) => [field, null])), siteid: 'SITE',
  wonum: 'WO', workorderid: '1', worktype: 'CM', status: 'APPR', bdpocdiscipline: 'E&I',
  targcompdate: '2026-09-30T00:00:00+07:00', wopriority: null };

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
