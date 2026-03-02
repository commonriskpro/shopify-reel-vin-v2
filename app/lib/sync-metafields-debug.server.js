/**
 * Structured logging for Sync metafields flow. Search in Vercel logs for SYNC_METAFIELDS.
 * No secrets; safe to log shop and step.
 */
const PREFIX = "SYNC_METAFIELDS";

/**
 * @param {string} step - e.g. "loader.start", "definitions.list", "definitions.pin"
 * @param {Record<string, unknown>} payload - shop, listRequested, error, etc.
 */
export function syncMetafieldsLog(step, payload = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    step,
    ...payload,
  });
  console.log(`${PREFIX} ${line}`);
}

/**
 * Log an error in the sync flow (also pass to logServerError if you have context).
 * @param {string} step
 * @param {Error | string} err
 * @param {Record<string, unknown>} [extra]
 */
export function syncMetafieldsError(step, err, extra = {}) {
  const message = err instanceof Error ? err.message : String(err);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    step,
    error: message,
    ...extra,
  });
  console.error(`${PREFIX} ${line}`);
}
