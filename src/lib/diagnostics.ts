/**
 * Client-side diagnostics (no third-party SDK). Use the browser console to trace failures.
 *
 * - Dev default: HTTP warnings on. Silence: `finance_os_diagnostics_verbose` = `0`.
 * - Prod default: quiet. Enable: set key to `1`.
 */

const TAG = '[Finance OS]';
const VERBOSE_KEY = 'finance_os_diagnostics_verbose';

export function isDiagnosticsVerbose(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(VERBOSE_KEY);
      if (v === '0') return false;
      if (v === '1') return true;
    }
  } catch {
    /* ignore */
  }
  return Boolean((typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV) || (typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production'));
}

/** Non-OK HTTP or transport failures when calling the API (dev or verbose only — avoids noisy consoles). */
export function logApiFailure(details: {
  method: string;
  path: string;
  status?: number;
  message: string;
}): void {
  if (!isDiagnosticsVerbose()) return;
  console.warn(TAG, 'api', details.method, details.path, details.status ?? '-', details.message);
}

/**
 * Thrown errors from hooks, auth, or other code paths that should not throw (always logged).
 * Safe meta: route names, hook names — never passwords or full tokens.
 */
export function logUnexpectedError(scope: string, error: unknown, meta?: Record<string, unknown>): void {
  const e = error instanceof Error ? error : new Error(String(error));
  if (meta && Object.keys(meta).length > 0) {
    console.error(TAG, scope, meta, e.message, e.stack);
  } else {
    console.error(TAG, scope, e.message, e.stack);
  }
}

/** Root route tree — full-screen fallback. */
export function logErrorBoundary(where: string, error: Error, componentStack: string | null | undefined): void {
  console.error(TAG, 'ErrorBoundary', where, error.message, error.stack, componentStack ?? '');
}

/** Optional UI (overlays) — failure is non-fatal; still logged so it is not silent. */
export function logSilentUiFailure(where: string, error: Error, componentStack: string | null | undefined): void {
  console.warn(TAG, 'SilentErrorBoundary', where, error.message, componentStack ?? '');
}
