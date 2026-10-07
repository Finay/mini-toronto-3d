import { describe, expect, it, vi } from 'vitest';
import { cached } from './cache';

describe('cached', () => {
  it('reloads only after the TTL has passed', async () => {
    let time = 0;
    const load = vi.fn(async () => time);
    const get = cached(100, load, () => time);

    expect((await get()).value).toBe(0);
    time = 99;
    expect((await get()).value).toBe(0);
    time = 100;
    expect((await get()).value).toBe(100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const load = vi.fn(async () => 'value');
    const get = cached(100, load);

    await Promise.all([get(), get(), get()]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the last good value as stale when a reload fails', async () => {
    let time = 0;
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce('good').mockRejectedValueOnce(new Error('down'));
    const get = cached(100, load, () => time);

    await get();
    time = 200;

    expect(await get()).toEqual({ value: 'good', fetchedAt: 0, stale: true });
  });

  it('rejects when the first load fails', async () => {
    const get = cached(100, async () => Promise.reject(new Error('down')));

    await expect(get()).rejects.toThrow('down');
  });
});
