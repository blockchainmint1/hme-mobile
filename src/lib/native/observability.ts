/**
 * Optional Sentry hook. No-op when SENTRY_DSN isn't set at build time
 * (import.meta.env.VITE_SENTRY_DSN) so the app ships fine without it.
 *
 * When you're ready:
 *   1. `bun add @sentry/capacitor @sentry/react`
 *   2. Set `VITE_SENTRY_DSN` in your build env.
 *   3. Native rebuild + resubmit (Sentry adds native code).
 */
export async function initObservability(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  try {
    const [{ init: initCapacitor }, sentryReact] = await Promise.all([
      import("@sentry/capacitor" as string),
      import("@sentry/react" as string),
    ]);
    initCapacitor(
      {
        dsn,
        tracesSampleRate: 0.1,
        environment: import.meta.env.MODE,
      },
      sentryReact.init,
    );
  } catch {
    /* @sentry/capacitor not installed — silently skip */
  }
}
