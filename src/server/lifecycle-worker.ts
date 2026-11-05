import type { PrismaClient } from './prisma-client';
import { finalizeDueReturns } from './exit-completion';

/** One reusable worker tick. Notifications can register their own independent tick later. */
export async function runLifecycleTick(db: PrismaClient, today: string) {
  return finalizeDueReturns(db, today);
}

/** Infrastructure only: the caller supplies clock, database and scheduler interval. */
export function startLifecycleWorker(
  tick: () => Promise<unknown>,
  intervalMs = 30_000
): () => void {
  if (!Number.isFinite(intervalMs) || intervalMs < 1)
    throw new RangeError('Positive interval required');
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try {
      await tick();
    } catch (error) {
      console.error('Lifecycle worker tick failed', error);
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void run();
        }, intervalMs);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
