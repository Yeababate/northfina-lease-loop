import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLifecycleWorker } from './lifecycle-worker';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('background lifecycle worker', () => {
  it('runs immediately and periodically without requiring a user request', async () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockResolvedValue(undefined);
    const stop = startLifecycleWorker(tick, 1000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('does not overlap a slow pass or restart after stopping an in-flight pass', async () => {
    vi.useFakeTimers();
    let resolve = () => {};
    const tick = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const stop = startLifecycleWorker(tick, 1000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
    resolve();
    await vi.advanceTimersByTimeAsync(10000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('logs a failed pass and keeps processing later passes', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tick = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue(undefined);
    const stop = startLifecycleWorker(tick, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it('rejects invalid cadence', () => {
    expect(() => startLifecycleWorker(async () => {}, 0)).toThrow(RangeError);
    expect(() => startLifecycleWorker(async () => {}, Infinity)).toThrow(RangeError);
  });
});
