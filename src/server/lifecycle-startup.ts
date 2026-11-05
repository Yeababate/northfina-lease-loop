import { db } from './db';
import { runLifecycleTick, startLifecycleWorker } from './lifecycle-worker';
import { todayIso } from './today';

const state = globalThis as typeof globalThis & { leaseLoopLifecycleStop?: () => void };

/** One loop per Node process, including development reloads; DB commands stay idempotent. */
export function registerLifecycleWorker() {
  if (state.leaseLoopLifecycleStop) return;
  state.leaseLoopLifecycleStop = startLifecycleWorker(() => runLifecycleTick(db, todayIso()));
  const stop = () => {
    state.leaseLoopLifecycleStop?.();
    delete state.leaseLoopLifecycleStop;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
