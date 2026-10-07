import { afterEach, expect, it, vi } from 'vitest';
import { getAdminRoster } from './admin';

afterEach(() => vi.unstubAllGlobals());

it('rejects roster values outside the configured system, environment and capability contract', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    users: [], connections: [{ id: 'c1', label: 'Onshore', system: 'unknown', environment: 'test', enabled: true, disciplines: ['E&I'] }],
    permissions: [], grants: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  await expect(getAdminRoster(new AbortController().signal)).rejects.toThrow('Phản hồi quản trị viên không hợp lệ.');
});
