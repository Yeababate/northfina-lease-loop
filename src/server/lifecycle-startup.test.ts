import { afterEach, describe, expect, it, vi } from 'vitest';

const stopWorker = vi.fn();
const startLifecycleWorker = vi.fn((tick: () => Promise<unknown>) => {
  void tick;
  return stopWorker;
});
const runLifecycleTick = vi.fn(async () => ({ completed: 0, failedIds: [] }));
vi.mock('./db', () => ({ db: { marker: 'db' } }));
vi.mock('./today', () => ({ todayIso: () => '2026-11-05' }));
vi.mock('./lifecycle-worker', () => ({ startLifecycleWorker, runLifecycleTick }));

const { registerLifecycleWorker } = await import('./lifecycle-startup');
const state = globalThis as typeof globalThis & { leaseLoopLifecycleStop?: () => void };

afterEach(() => {
  delete state.leaseLoopLifecycleStop;
  vi.restoreAllMocks();
  stopWorker.mockClear();
  startLifecycleWorker.mockClear();
});

describe('registerLifecycleWorker', () => {
  it('starts one loop per process whose tick uses the database and today', async () => {
    const handlers = new Map<string, () => void>();
    const once = process.once.bind(process);
    vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
      if (event !== 'SIGTERM' && event !== 'SIGINT') return once(event, handler);
      handlers.set(event, handler);
      return process;
    }) as typeof process.once);

    registerLifecycleWorker();
    registerLifecycleWorker();
    expect(startLifecycleWorker).toHaveBeenCalledTimes(1);

    const tick = startLifecycleWorker.mock.calls[0]?.[0];
    await tick?.();
    expect(runLifecycleTick).toHaveBeenCalledWith({ marker: 'db' }, '2026-11-05');

    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
    handlers.get('SIGINT')?.();
    expect(stopWorker).toHaveBeenCalledTimes(1);
    expect(state.leaseLoopLifecycleStop).toBeUndefined();
    // A second signal after stopping is harmless.
    handlers.get('SIGTERM')?.();
    expect(stopWorker).toHaveBeenCalledTimes(1);
  });
});
