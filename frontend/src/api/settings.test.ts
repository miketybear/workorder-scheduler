import { afterEach, expect, it, vi } from 'vitest';
import { getConnectionSettings, saveConnectionSetting } from './settings';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const raw = { user: { id: 'user', name: 'Planner', is_admin: false }, preferred_connection_id: null,
  grants: [{ connection_id: 'one', label: 'Onshore', system: 'onshore', environment: 'test', timezone: 'Asia/Ho_Chi_Minh', discipline: 'MECH', capability: 'read' }],
  connections: [{ connection_id: 'one', url: 'https://maximo.invalid/maximo' }] };

it.each(['ungranted', 'credentials', 'duplicate', 'preference'])('rejects malformed settings data: %s', async (fault) => {
  const value = structuredClone(raw) as Record<string, unknown>;
  if (fault === 'ungranted') value.connections = [{ connection_id: 'two', url: 'https://other.invalid/maximo' }];
  if (fault === 'credentials') value.connections = [{ connection_id: 'one', url: 'https://user:secret@maximo.invalid/maximo' }];
  if (fault === 'duplicate') value.connections = [raw.connections[0], raw.connections[0]];
  if (fault === 'preference') value.preferred_connection_id = { connection_id: 'one' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
  await expect(getConnectionSettings(new AbortController().signal)).rejects.toThrow();
});
it('sends only the connection ID with CSRF and never persists URL or discipline from the client', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-wos-csrf=synthetic-csrf');
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await saveConnectionSetting('one', new AbortController().signal);
  expect(fetcher.mock.calls[0][0]).toBe('/api/settings/connection');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'PUT', cache: 'no-store', credentials: 'same-origin', headers: { 'X-CSRF-Token': 'synthetic-csrf' } });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ connection_id: 'one' });
});
it('does not send a preference mutation without CSRF', async () => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(saveConnectionSetting('one', new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
