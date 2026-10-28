import { afterEach, expect, it, vi } from 'vitest';
import { createRouteSession, getRouteStatus, parsePreview, parseResult, previewRoute, RouteApiError, routeWorkOrders } from './workflowRoute';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const scope = { connection_id: 'conn', discipline: 'E&I' };
const respond = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status });

it('reads the feature status and sends CSRF only on writes', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=token');
  const fetcher = vi.fn().mockResolvedValue(respond(200, { enabled: true, can_route: true, personid: 'ENISUP', session: { active: false, expires_at: null } }));
  vi.stubGlobal('fetch', fetcher);
  await expect(getRouteStatus(scope, new AbortController().signal)).resolves.toMatchObject({ can_route: true, personid: 'ENISUP' });
  expect(fetcher.mock.calls[0][1].headers).toEqual({});
  fetcher.mockResolvedValue(respond(200, { contract: { ok: true, problem: null }, items: [] }));
  await previewRoute(scope, [{ site_id: 'BD1', workorder_id: '1' }], new AbortController().signal);
  expect(fetcher.mock.calls[1][1].headers['X-CSRF-Token']).toBe('token');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ ...scope, items: [{ site_id: 'BD1', workorder_id: '1' }] });
});

it('turns server error details into typed errors without echoing the password', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=token');
  const fetcher = vi.fn().mockResolvedValue(respond(422, { detail: { code: 'maximo_login_failed', remaining_attempts: 2 } }));
  vi.stubGlobal('fetch', fetcher);
  const error = await createRouteSession(scope, 'ENISUP', 'pw-1', new AbortController().signal).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(RouteApiError);
  expect(error).toMatchObject({ status: 422, code: 'maximo_login_failed', extra: { remaining_attempts: 2 } });
  expect(JSON.stringify(error)).not.toContain('pw-1');
  fetcher.mockResolvedValue(respond(409, { detail: { code: 'workflow_contract_changed', problem: 'node_34_condition_present' } }));
  await expect(routeWorkOrders(scope, 'r', [], new AbortController().signal)).rejects.toMatchObject({ code: 'workflow_contract_changed', extra: { problem: 'node_34_condition_present' } });
  fetcher.mockResolvedValue(respond(404, { detail: 'Work order not found' }));
  await expect(getRouteStatus(scope, new AbortController().signal)).rejects.toMatchObject({ status: 404, code: null });
});

it('refuses to write without a CSRF cookie', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
  vi.stubGlobal('fetch', vi.fn());
  await expect(previewRoute(scope, [], new AbortController().signal)).rejects.toMatchObject({ status: 401 });
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects malformed answers instead of guessing', () => {
  expect(() => parsePreview({ items: [] })).toThrow();
  expect(() => parseResult({ request_id: 'r', complete: true, counts: {}, items: [{ site_id: 'BD1', workorder_id: '1', state: 'weird' }] })).toThrow();
  const ok = parseResult({ request_id: 'r', complete: false, counts: { confirmed: 1 }, items: [{ site_id: 'BD1', workorder_id: '1', wonum: 'P1', state: 'stranded',
    code: 'stranded_no_assignment', wfassignment_id_after: null, assigned_to: null }] });
  expect(ok.items[0].state).toBe('stranded');
  expect(ok.counts).toEqual({ confirmed: 1 });
});

it('preserves upload_pending in route preview and rejected results', () => {
  const identity = { site_id: 'BD1', workorder_id: '1', wonum: 'P1', code: 'upload_pending', assigned_to: null };
  const preview = parsePreview({ contract: { ok: true, problem: null }, items: [{ ...identity,
    ready: false, node_id: null, wfassignment_id: null, supervisor: null }] });
  expect(preview.items[0]).toMatchObject({ code: 'upload_pending', ready: false });
  const result = parseResult({ request_id: 'r', complete: true, counts: { rejected: 1 }, items: [{ ...identity,
    state: 'rejected', wfassignment_id_after: null }] });
  expect(result.items[0]).toMatchObject({ code: 'upload_pending', state: 'rejected' });
});
