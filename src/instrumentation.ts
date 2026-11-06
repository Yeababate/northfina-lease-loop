// Runs once when a Next.js server instance starts (see the installed docs:
// node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). Starts background work
// in the running Node.js server only, never during a build or a test run:
//   - the lifecycle worker, which finalises due early returns (#6);
//   - the lease-end reminder worker (#10). It is not awaited as a loop: register() returns
//     at once while its first catch-up pass runs in the background. Set
//     LEASE_LOOP_WORKER=off to run the server without it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NODE_ENV === 'test') return;

  const [{ db }, { restoreParticipantsFromSigningRecords }, { registerLifecycleWorker }] =
    await Promise.all([
      import('./server/db'),
      import('./server/legacy-contracts'),
      import('./server/lifecycle-startup'),
    ]);
  await restoreParticipantsFromSigningRecords(db);
  registerLifecycleWorker();

  if (process.env.LEASE_LOOP_WORKER === 'off') return;
  const { startAppWorker } = await import('./server/reminders/worker');
  startAppWorker(db);
}
