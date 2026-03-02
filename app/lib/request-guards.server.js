/**
 * Request guards for security: Content-Type and body size for JSON POSTs.
 * Use at the start of actions that expect application/json.
 * @see docs/security-qa-plan.md F3, F5
 */

/** Default max JSON body size for admin POST (2MB). */
export const DEFAULT_MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

/**
 * If request should be rejected (wrong Content-Type or body too large), returns a Response; otherwise null.
 * Call before reading body (e.g. before request.json()).
 * @param {Request} request
 * @param {{ maxBytes?: number; requestId?: string }} [opts]
 * @returns {Response | null}
 */
export function requireJsonPost(request, opts = {}) {
  const { maxBytes = DEFAULT_MAX_JSON_BODY_BYTES, requestId } = opts;
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return Response.json(
      { ok: false, error: { message: "Content-Type must be application/json", code: "UNSUPPORTED_MEDIA_TYPE" }, ...(requestId ? { meta: { requestId } } : {}) },
      { status: 415, headers: requestId ? { "x-request-id": requestId } : {} }
    );
  }
  const cl = request.headers.get("content-length");
  if (cl != null) {
    const len = parseInt(cl, 10);
    if (!Number.isNaN(len) && len > maxBytes) {
      return Response.json(
        { ok: false, error: { message: "Request body too large", code: "PAYLOAD_TOO_LARGE" }, ...(requestId ? { meta: { requestId } } : {}) },
        { status: 413, headers: requestId ? { "x-request-id": requestId } : {} }
      );
    }
  }
  return null;
}
