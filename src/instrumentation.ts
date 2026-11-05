/** Register background lifecycle work only in the running Node server, never a build. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.NODE_ENV !== 'test'
  ) {
    const { registerLifecycleWorker } = await import('./server/lifecycle-startup');
    registerLifecycleWorker();
  }
}
