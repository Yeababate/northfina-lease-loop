// The app-level wiring of the reminder worker: the reminder job, the once-per-process
// worker and its shutdown handling. The loop itself is covered in worker.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../prisma-client';

const runReminderPass = vi.fn(async () => ({ processed: 0 }));
vi.mock('./processor', () => ({ runReminderPass }));
const runWaitingListFollowUp = vi.fn(async () => ({ asked: 0, expired: 0, failed: 0 }));
vi.mock('../waiting-list-follow-up', () => ({ runWaitingListFollowUp }));

const { WORKER_INTERVAL_MS, reminderJob, startAppWorker, startWorker, waitingListFollowUpJob } =
  await import('./worker');

const db = {} as PrismaClient;
const state = globalThis as typeof globalThis & { leaseLoopWorker?: unknown };
type Handler = (signal: 'SIGTERM' | 'SIGINT') => void;

/** Records SIGTERM/SIGINT handlers instead of installing them; anything else passes through. */
function captureSignals(listeners: number) {
  const handlers = new Map<string, Handler>();
  const once = process.once.bind(process);
  const count = process.listenerCount.bind(process);
  vi.spyOn(process, 'once').mockImplementation(((event: string, handler: Handler) => {
    if (event !== 'SIGTERM' && event !== 'SIGINT') return once(event, handler);
    handlers.set(event, handler);
    return process;
  }) as typeof process.once);
  vi.spyOn(process, 'listenerCount').mockImplementation(((event: string) =>
    event === 'SIGTERM' || event === 'SIGINT'
      ? listeners
      : count(event)) as typeof process.listenerCount);
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  return { handlers, exit };
}

beforeEach(() => {
  runReminderPass.mockClear();
  runWaitingListFollowUp.mockClear();
});
afterEach(async () => {
  const worker = state.leaseLoopWorker as { stop: () => Promise<void> } | undefined;
  await worker?.stop();
  delete state.leaseLoopWorker;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reminderJob', () => {
  it('runs a reminder pass with the pass time and the given contacts', async () => {
    const contacts = vi.fn(async () => ({ email: null }));
    const job = reminderJob(db, contacts);
    const now = new Date('2026-11-05T07:00:00.000Z');
    await job.run(now);
    expect(job.name).toBe('lease-end-reminders');
    expect(runReminderPass).toHaveBeenCalledWith(db, now, { contacts });
  });
});

describe('waitingListFollowUpJob', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs the follow-up with the Helsinki date of the pass time', async () => {
    vi.stubEnv('LEASE_LOOP_TODAY', '');
    const contacts = vi.fn(async () => ({ email: null }));
    const job = waitingListFollowUpJob(db, contacts);
    const now = new Date('2026-11-30T22:30:00.000Z'); // already 1 Dec in Helsinki
    await job.run(now);
    expect(job.name).toBe('waiting-list-follow-up');
    expect(runWaitingListFollowUp).toHaveBeenCalledWith(db, '2026-12-01', now, { contacts });
  });

  it('follows the demo date when LEASE_LOOP_TODAY is set', async () => {
    vi.stubEnv('LEASE_LOOP_TODAY', '2027-01-15');
    const now = new Date('2026-11-05T07:00:00.000Z');
    await waitingListFollowUpJob(db).run(now);
    expect(runWaitingListFollowUp).toHaveBeenCalledWith(db, '2027-01-15', now, {
      contacts: expect.any(Function),
    });
  });
});

describe('startWorker defaults', () => {
  it('reads the real clock and waits the default interval between passes', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-05T07:00:00.000Z') });
    const seen: Date[] = [];
    const worker = startWorker([{ name: 'job', run: async (now) => void seen.push(now) }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([new Date('2026-11-05T07:00:00.000Z')]);
    await vi.advanceTimersByTimeAsync(WORKER_INTERVAL_MS - 1);
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveLength(2);
    await worker.stop();
  });

  it('schedules nothing when stopped during the first pass', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const worker = startWorker([{ name: 'slow', run }], { intervalMs: 5 });
    const stopping = worker.stop();
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('startAppWorker', () => {
  it('starts one worker per process and stops it on a signal', async () => {
    // Another listener handles the signal, so the worker must not exit the process.
    const { handlers, exit } = captureSignals(1);

    const worker = startAppWorker(db);
    expect(startAppWorker(db)).toBe(worker);
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
    await vi.waitFor(() => expect(runReminderPass).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(runWaitingListFollowUp).toHaveBeenCalledTimes(1));

    const stop = vi.spyOn(worker, 'stop');
    handlers.get('SIGTERM')?.('SIGTERM');
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('exits with the usual code on %s when nothing else listens', async (signal, code) => {
    const { handlers, exit } = captureSignals(0);
    startAppWorker(db);
    handlers.get(signal)?.(signal);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(code));
  });
});
