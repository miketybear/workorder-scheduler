import { afterEach, expect, it, vi } from 'vitest';
import { forgetShared } from './shared';
import { getAuthSummary } from './client';

afterEach(() => { forgetShared(); vi.unstubAllGlobals(); });

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/auth/configuration')
    ? new Response(JSON.stringify({ login_available: true }), { status: 200 })
    : new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('shares one auth request pair between concurrent callers and refetches afterwards', async () => {
  const fetchMock = stubFetch();
  const [first, second] = await Promise.all([getAuthSummary(), getAuthSummary(new AbortController().signal)]);
  expect(first).toEqual({ available: true, session: null });
  expect(second).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await getAuthSummary();
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('bypasses sharing for a fresh check', async () => {
  const fetchMock = stubFetch();
  await Promise.all([getAuthSummary(), getAuthSummary(undefined, { fresh: true })]);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
