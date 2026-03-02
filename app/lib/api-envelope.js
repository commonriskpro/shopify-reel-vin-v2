/**
 * Fixed API response envelope helpers.
 * @see docs/DMS-STEP1-SPEC.md §4
 */

/** Max JSON body size (100kb) for POST /api routes. */
export const MAX_JSON_BODY_BYTES = 100 * 1024;

/**
 * Reject request if Content-Length exceeds limit. Call before reading body.
 * @param {Request} request
 * @param {number} [limit]
 * @returns {Response | null} 413 envelope response or null if OK
 */
export function rejectIfBodyTooLarge(request, limit = MAX_JSON_BODY_BYTES) {
  const cl = request.headers.get("content-length");
  if (cl == null) return null;
  const len = parseInt(cl, 10);
  if (Number.isNaN(len) || len <= limit) return null;
  const requestId = makeRequestId(request);
  return Response.json(
    err({ code: "PAYLOAD_TOO_LARGE", message: "Request body too large", source: "VALIDATION" }, { requestId }),
    { status: 413 }
  );
}

/** @returns {string} */
export function makeRequestId(request) {
  if (request && typeof request.headers?.get === "function") {
    const id = request.headers.get("x-request-id");
    if (id) return id;
  }
  return crypto.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @template T
 * @param {T} data
 * @param {{ requestId?: string; warnings?: Array<{ code: string; message: string }> }} [opts]
 * @returns {{ ok: true; data: T; meta?: { requestId: string; warnings?: Array<{ code: string; message: string }> } }}
 */
export function ok(data, opts = {}) {
  const out = { ok: true, data };
  if (opts.requestId || (opts.warnings && opts.warnings.length > 0)) {
    out.meta = {};
    if (opts.requestId) out.meta.requestId = opts.requestId;
    if (opts.warnings && opts.warnings.length > 0) out.meta.warnings = opts.warnings;
  }
  return out;
}

/**
 * @param {{ code: string; message: string; source?: "VALIDATION"|"SHOPIFY"|"VPIC"|"DB"|"INTERNAL"; fieldErrors?: Record<string, string[]>; details?: unknown; retryable?: boolean }}
 * @param {{ requestId?: string }} [opts]
 * @returns {{ ok: false; error: object; meta?: { requestId: string } }}
 */
export function err(errorPayload, opts = {}) {
  const out = {
    ok: false,
    error: {
      code: errorPayload.code,
      message: errorPayload.message,
      ...(errorPayload.source != null && { source: errorPayload.source }),
      ...(errorPayload.fieldErrors != null && { fieldErrors: errorPayload.fieldErrors }),
      ...(errorPayload.details != null && { details: errorPayload.details }),
      ...(errorPayload.retryable != null && { retryable: errorPayload.retryable }),
    },
  };
  if (opts.requestId) out.meta = { requestId: opts.requestId };
  return out;
}

/**
 * @param {import("zod").ZodError} zerr
 * @returns {Record<string, string[]>}
 */
export function zodErrorToFieldErrors(zerr) {
  const fieldErrors = {};
  for (const issue of zerr.errors) {
    const path = issue.path.filter(Boolean).join(".") || "body";
    if (!fieldErrors[path]) fieldErrors[path] = [];
    fieldErrors[path].push(issue.message);
  }
  return fieldErrors;
}
