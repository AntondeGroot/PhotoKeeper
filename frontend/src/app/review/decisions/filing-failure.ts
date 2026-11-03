import { HttpErrorResponse } from '@angular/common/http';

/** The backend's status for "Lightroom answered, and the answer was no" — see GlobalExceptionHandler. */
const LIGHTROOM_REFUSED = 424;

/**
 * Whether a write failed for want of an answer, rather than because Lightroom gave one.
 *
 * The next photo would fail the same way, so this is the signal to stop. Carrying on sends every
 * remaining photo into the same dead connection, and reports the lot as refused.
 */
export function isConnectionFailure(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status !== LIGHTROOM_REFUSED;
}

/**
 * Whether Lightroom refused a write because the photograph no longer exists.
 *
 * It arrives as a 403 whose body carries a per-asset error with `http_status` 410, as seen in the
 * production log on 2026-11-03. Only meaningful for a single-photo write: a batch's refusal does not
 * say every member is gone.
 */
export function isAssetGone(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const detail = (error.error as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' && detail.includes('"http_status":410');
}
