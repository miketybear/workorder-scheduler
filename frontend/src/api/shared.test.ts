import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetShared, shared } from './shared';

afterEach(() => forgetShared());

describe('shared reads', () => {
  it('joins concurrent calls and asks again once the first has settled', async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = shared('k', load);
    const second = shared('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    resolve('one');
    await expect(Promise.all([first, second])).resolves.toEqual(['one', 'one']);
    const again = vi.fn().mockResolvedValue('two');
    await expect(shared('k', again)).resolves.toBe('two');
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('lets one caller abort without cancelling the others', async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const controller = new AbortController();
    const aborted = shared('k', load, controller.signal);
    const kept = shared('k', load);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    resolve('still here');
    await expect(kept).resolves.toBe('still here');
  });

  it('rejects immediately for an already aborted signal', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(shared('k', () => Promise.resolve(1), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not share a fresh check, and shares failures with joined callers only while in flight', async () => {
    let resolve!: (value: string) => void;
    const slow = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const joined = shared('k', slow);
    const fresh = vi.fn().mockResolvedValue('new');
    await expect(shared('k', fresh, undefined, true)).resolves.toBe('new');
    expect(fresh).toHaveBeenCalledTimes(1);
    resolve('old');
    await expect(joined).resolves.toBe('old');
    const failing = vi.fn().mockRejectedValue(new Error('down'));
    await expect(shared('f', failing)).rejects.toThrow('down');
    const recovered = vi.fn().mockResolvedValue('up');
    await expect(shared('f', recovered)).resolves.toBe('up');
  });

  it('forgets in-flight reads after a change', async () => {
    let resolve!: (value: string) => void;
    const first = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const stale = shared('k', first);
    forgetShared();
    const second = vi.fn().mockResolvedValue('current');
    await expect(shared('k', second)).resolves.toBe('current');
    resolve('old'); await stale;
    expect(second).toHaveBeenCalledTimes(1);
  });
});
