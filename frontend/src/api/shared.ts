// Concurrent identical reads share one request. Nothing is cached after it settles, so a later
// call always asks the server again. Callers keep their own AbortSignal: aborting stops that
// caller's wait without cancelling the shared request for the others.
const inflight = new Map<string, Promise<unknown>>();

function abortError() { return new DOMException('The operation was aborted.', 'AbortError'); }

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

export function shared<T>(key: string, load: () => Promise<T>, signal?: AbortSignal, fresh = false): Promise<T> {
  // Checks that gate a write must not join a request that started before the decision: fresh skips sharing.
  if (fresh) return waitFor(load(), signal);
  let promise = inflight.get(key) as Promise<T> | undefined;
  if (!promise) {
    const started: Promise<T> = load().finally(() => { if (inflight.get(key) === started) inflight.delete(key); });
    promise = started;
    inflight.set(key, started);
  }
  return waitFor(promise, signal);
}

/** Drop in-flight reads after a change that makes them stale (sign-out, saved connection). */
export function forgetShared(): void { inflight.clear(); }
