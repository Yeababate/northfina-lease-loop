// Runs once when a Next.js server instance starts (see the installed docs:
// node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). Starts the background
// reminder worker in the Node.js runtime only. It is not awaited as a loop: register()
// returns at once while the worker's first catch-up pass runs in the background.
// Set LEASE_LOOP_WORKER=off to run the server without it (for example in a test run).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.LEASE_LOOP_WORKER === 'off') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const [{ db }, { startAppWorker }] = await Promise.all([
    import('./server/db'),
    import('./server/reminders/worker'),
  ]);
  startAppWorker(db);
}
