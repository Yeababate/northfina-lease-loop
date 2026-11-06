// The background runner: an immediate pass at startup (catch-up after downtime), then a
// pass every 30 seconds. Passes never overlap in one process; several processes stay
// safe through the database claims and unique coverage in processor.ts. Each job runs
// on its own, so a failing job (for example a future due-return finalizer) cannot block
// reminders, or the other way round. The clock is read here, once per pass.
import { loadCustomers } from '@/data/load';
import type { PrismaClient } from '../prisma-client';
import { demoToday, todayIso } from '../today';
import { runWaitingListFollowUp } from '../waiting-list-follow-up';
import { runReminderPass, type ReminderContacts } from './processor';

export const WORKER_INTERVAL_MS = 30_000;

export type WorkerJob = { name: string; run: (now: Date) => Promise<unknown> };

export type Worker = { stop: () => Promise<void>; runOnce: () => Promise<void> };

/** Starts the loop. `stop()` clears the timer and waits for a running pass to finish. */
export function startWorker(
  jobs: readonly WorkerJob[],
  options: { intervalMs?: number; clock?: () => Date } = {}
): Worker {
  const intervalMs = options.intervalMs ?? WORKER_INTERVAL_MS;
  const clock = options.clock ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;

  const runOnce = async () => {
    if (running) return running; // never overlap
    running = (async () => {
      const now = clock();
      for (const job of jobs) {
        try {
          await job.run(now);
        } catch (error) {
          console.error(`Background job "${job.name}" failed; it runs again next tick:`, error);
        }
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  };

  const loop = async () => {
    await runOnce();
    if (!stopped) {
      timer = setTimeout(loop, intervalMs);
      timer.unref?.();
    }
  };
  void loop();

  return {
    runOnce,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

/** Email addresses come from the customer data pack; a missing one skips email only. */
export const dataPackContacts: ReminderContacts = async (recipientId) => {
  const customer = (await loadCustomers()).find((c) => c.id === recipientId);
  return { email: customer?.email ?? null };
};

export function reminderJob(db: PrismaClient, contacts = dataPackContacts): WorkerJob {
  return { name: 'lease-end-reminders', run: (now) => runReminderPass(db, now, { contacts }) };
}

/**
 * "Do you still want this?" for waiting-list entries past their needed-by date (#75). It
 * sends through the same inbox and simulated email as the lease-end reminders. Business
 * dates follow the app's today, so LEASE_LOOP_TODAY replays the demo dates here as well.
 */
export function waitingListFollowUpJob(db: PrismaClient, contacts = dataPackContacts): WorkerJob {
  return {
    name: 'waiting-list-follow-up',
    run: (now) => runWaitingListFollowUp(db, demoToday() ?? todayIso(now), now, { contacts }),
  };
}

const globalForWorker = globalThis as typeof globalThis & { leaseLoopWorker?: Worker };

/** Starts the app's single worker once per server process (dev hot reload included). */
export function startAppWorker(db: PrismaClient): Worker {
  if (globalForWorker.leaseLoopWorker) return globalForWorker.leaseLoopWorker;
  const worker = startWorker([reminderJob(db), waitingListFollowUpJob(db)]);
  globalForWorker.leaseLoopWorker = worker;
  // Stop the timer on shutdown. If nothing else handles the signal, exit as Node would.
  const shutdown = (signal: 'SIGTERM' | 'SIGINT') => {
    void worker.stop().finally(() => {
      if (process.listenerCount(signal) === 0) process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return worker;
}
