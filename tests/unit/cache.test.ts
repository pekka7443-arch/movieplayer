import { describe, expect, it, vi } from 'vitest';

import { withCache, clearApiCache } from '@/lib/server/cache';

describe('withCache', () => {
  it('serves repeated reads from cache (fetcher called once)', async () => {
    clearApiCache();
    const fetcher = vi.fn(async () => ({ value: 42 }));
    const a = await withCache('k1', fetcher, { ttlMs: 60_000, staleMs: 0 });
    const b = await withCache('k1', fetcher, { ttlMs: 60_000, staleMs: 0 });
    expect(a).toEqual({ value: 42 });
    expect(b).toEqual({ value: 42 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent misses into one request', async () => {
    clearApiCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 25));
      return { calls };
    };
    const [a, b, c] = await Promise.all([
      withCache('k2', fetcher, { ttlMs: 60_000, staleMs: 0 }),
      withCache('k2', fetcher, { ttlMs: 60_000, staleMs: 0 }),
      withCache('k2', fetcher, { ttlMs: 60_000, staleMs: 0 }),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('serves stale entries while refreshing in the background', async () => {
    clearApiCache();
    let version = 1;
    const fetcher = async () => ({ version });
    const first = await withCache('k3', fetcher, { ttlMs: 10, staleMs: 60_000 });
    expect(first).toEqual({ version: 1 });

    // Expire the fresh window.
    version = 2;
    await new Promise((r) => setTimeout(r, 15));
    const second = await withCache('k3', fetcher, { ttlMs: 10, staleMs: 60_000 });
    // Served from the stale window immediately…
    expect(second).toEqual({ version: 1 });
    // …and refreshed in the background.
    await new Promise((r) => setTimeout(r, 30));
    const third = await withCache('k3', fetcher, { ttlMs: 60_000, staleMs: 0 });
    expect(third).toEqual({ version: 2 });
  });

  it('bypasses the cache when the fetcher throws', async () => {
    clearApiCache();
    const failing = vi.fn(async () => {
      throw new Error('upstream down');
    });
    await expect(withCache('k4', failing, { ttlMs: 60_000, staleMs: 0 })).rejects.toThrow('upstream down');
    await expect(withCache('k4', failing, { ttlMs: 60_000, staleMs: 0 })).rejects.toThrow('upstream down');
    expect(failing).toHaveBeenCalledTimes(2); // no negative caching
  });
});
