import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { clearApiCache, withCache } from '@/lib/server/cache';
import { withRetries, UpstreamError } from '@/lib/server/http';

describe('withRetries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetries(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries network errors with backoff and then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('recovered');
    const promise = withRetries(fn, { baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails fast on deterministic 4xx status errors', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    await expect(withRetries(fn)).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx status errors up to the attempt cap', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 502 }));
    const promise = withRetries(fn, { attempts: 3, baseDelayMs: 10 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    const err = await promise;
    expect(fn).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(Error);
  });

  it('retries values flagged by retryIf then succeeds', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ data: true });
    const promise = withRetries(fn, { retryIf: (v) => v === null, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toEqual({ data: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exposes UpstreamError with status', () => {
    const e = new UpstreamError('bad', 503);
    expect(e.status).toBe(503);
    expect(e.name).toBe('UpstreamError');
  });
});

describe('withCache stale-on-failure', () => {
  beforeEach(() => {
    clearApiCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the last known value when the upstream goes down after the fresh window', async () => {
    let failing = false;
    let value = 1;
    const fetcher = async () => {
      if (failing) throw new Error('upstream down');
      return value;
    };

    // Prime the cache.
    await expect(withCache('k1', fetcher, { ttlMs: 1_000, staleMs: 60_000 })).resolves.toBe(1);

    // Past the fresh window but inside the stale window: SWR serves stale
    // and its background refresh re-caches value 2.
    vi.advanceTimersByTime(2_000);
    value = 2;
    await expect(withCache('k1', fetcher, { ttlMs: 1_000, staleMs: 60_000 })).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(0); // let the background refresh land

    // Upstream dies while the re-cached entry is still within its stale
    // window: even a failed full refresh falls back to the last value.
    failing = true;
    vi.advanceTimersByTime(2_000); // t≈4s: past fresh (4s), inside stale (63s)
    await expect(withCache('k1', fetcher, { ttlMs: 1_000, staleMs: 60_000 })).resolves.toBe(2);
  });

  it('still throws when there is no cached value at all', async () => {
    const fetcher = async () => {
      throw new Error('down from the start');
    };
    await expect(withCache('k2', fetcher)).rejects.toThrow('down from the start');
  });
});
