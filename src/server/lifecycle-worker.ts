import type { PrismaClient } from './prisma-client';
import { finalizeDueReturns as finalizeEarlyReturns } from './exit-completion';
import { finalizeDueReturns as finalizeIntakeReturns } from './next-life-commands';

/** One reusable worker tick. Notifications can register their own independent tick later. */
export async function runLifecycleTick(db: PrismaClient, today: string) {
  const early = await finalizeEarlyReturns(db, today);
  const choices = await db.endTermChoice.findMany({
    where: { kind: 'end_return', completedOn: null },
    select: { contractId: true },
  });
  const completed = choices.length
    ? await finalizeIntakeReturns(
        db,
        today,
        choices.map((choice) => choice.contractId)
      )
    : 0;
  return { ...early, completed: early.completed + completed };
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
