import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataPackContacts, startWorker } from './worker';

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('startWorker', () => {
  it('runs a pass at startup, then on its interval, with the clock read once per pass', async () => {
    const seen: Date[] = [];
    const clock = vi.fn(() => new Date('2026-11-05T07:00:00.000Z'));
    const worker = startWorker([{ name: 'job', run: async (now) => void seen.push(now) }], {
      intervalMs: 10,
      clock,
    });
    await tick();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await worker.stop();
    const count = seen.length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(clock).toHaveBeenCalledTimes(count);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen.length).toBe(count);
  });

  it('never overlaps passes and keeps going when one job fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let active = 0;
    let maxActive = 0;
    const other = vi.fn(async () => {});
    let release: () => void = () => {};
    const slow = {
      name: 'slow',
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => (release = resolve));
        active -= 1;
        throw new Error('boom');
      },
    };
    const worker = startWorker([slow, { name: 'other', run: other }], { intervalMs: 1 });
    await tick();
    const extra = worker.runOnce(); // joins the running pass instead of starting another
    release();
    await extra;
    expect(maxActive).toBe(1);
    expect(other).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    const stopping = worker.stop();
    release();
    await stopping;
  });
});

describe('dataPackContacts', () => {
  it('finds a customer email and gives null for an unknown recipient', async () => {
    expect(await dataPackContacts('cust-aino')).toEqual({ email: 'aino.virtanen@example.com' });
    expect(await dataPackContacts('nobody')).toEqual({ email: null });
  });
});
