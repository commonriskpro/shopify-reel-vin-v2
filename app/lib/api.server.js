/**
 * Central API route utilities. Every /api/* route MUST use these so responses
 * are always application/json (no redirects, no HTML 502).
 *
 * WHY THIS FIXES INTERMITTENT 502/non-JSON AUTH ERRORS:
 *   - requireAdmin() now logs a structured single line on every auth failure
 *     (path, hasAuthHeader, hasShopParam, requestId) so Vercel logs show exactly
 *     WHY auth failed without exposing token values.
 *   - Both jsonOk() and jsonFail() now set x-request-id as a RESPONSE HEADER
 *     (not just in the body), so clients can read it even on non-JSON fallback
 *     paths and include it in error UI.
 *   - apiRoute() injects x-request-id onto handler responses that pass through
 *     the JSON-content-type check, so every /api/* response carries the header.
 *   - All auth failures resolve to 401 JSON — never a 502 — because every
 *     thrown Response from authenticate.admin() is caught and re-thrown as
 *     ApiError(401) before it can propagate out of the Vercel function boundary.
 */
import { authenticate } from "../shopify.server";
import { logServerError } from "../http.server.js";
import { makeRequestId as makeRequestIdFromEnvelope, MAX_JSON_BODY_BYTES } from "./api-envelope.js";

/** Re-export for single import in API routes. */
export const makeRequestId = makeRequestIdFromEnvelope;

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Default max JSON body size for parseJsonBody (100KB). */
export const DEFAULT_MAX_JSON_BODY_BYTES = MAX_JSON_BODY_BYTES;

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

/**
 * API error with HTTP status. Thrown by requireAdmin or services; apiRoute
 * catches it and returns jsonFail with the matching status code.
 */
export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status (401, 400, 404, 502, etc.)
   * @param {string} message - Short, user-facing message
   * @param {{ code?: string; details?: unknown }} [opts]
   */
  constructor(status, message, opts = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = opts?.code ?? (status === 401 ? "UNAUTHORIZED" : "ERROR");
    this.details = opts?.details;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Emit a single structured log line on every /api auth failure.
 * NEVER logs token values — only boolean presence flags.
 * @param {string} urlStr
 * @param {boolean} hasAuthHeader
 * @param {boolean} hasShopParam
 * @param {string} requestId
 */
function logAuthFailure(urlStr, hasAuthHeader, hasShopParam, requestId) {
  try {
    const path = new URL(urlStr).pathname;
    console.warn(
      `[api.auth/FAIL] path=${path} hasAuthHeader=${hasAuthHeader} hasShopParam=${hasShopParam} requestId=${requestId}`
    );
  } catch {
    console.warn(
      `[api.auth/FAIL] path=unknown hasAuthHeader=${hasAuthHeader} hasShopParam=${hasShopParam} requestId=${requestId}`
    );
  }
}

// ---------------------------------------------------------------------------
// parseJsonBody
// ---------------------------------------------------------------------------

/**
 * Parse JSON body with size guard. Throws ApiError (413 or 400) so apiRoute
 * returns the right JSON error — not an unhandled exception that becomes 502.
 * @param {Request} request
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<unknown>}
 * @throws {ApiError}
 */
export async function parseJsonBody(request, { maxBytes = DEFAULT_MAX_JSON_BODY_BYTES } = {}) {
  const cl = request.headers.get("content-length");
  if (cl != null) {
    const len = parseInt(cl, 10);
    if (!Number.isNaN(len) && len > maxBytes) {
      throw new ApiError(413, "Request body too large", { code: "PAYLOAD_TOO_LARGE" });
    }
  }
  try {
    return await request.json();
  } catch (_) {
    throw new ApiError(400, "Invalid JSON", { code: "INVALID_JSON" });
  }
}

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

/**
 * Authenticate the request as an embedded Shopify admin request.
 * NEVER redirects for /api/* routes; always throws ApiError(401) on failure.
 *
 * Logs a structured line on every failure (no tokens logged — only boolean flags):
 *   [api.auth/FAIL] path=… hasAuthHeader=… hasShopParam=… requestId=…
 *
 * @param {Request} request
 * @returns {Promise<{ admin: object; session: object }>}
 * @throws {ApiError} 401 on any auth failure
 */
export async function requireAdmin(request) {
  const requestId = makeRequestId(request);
  const hasAuthHeader = request.headers.has("authorization");
  let hasShopParam = false;
  try {
    hasShopParam = new URL(request.url).searchParams.has("shop");
  } catch { /* malformed URL — treat as missing */ }

  try {
    const auth = await authenticate.admin(request);

    // authenticate.admin() can return a Response (redirect) instead of throwing.
    if (auth instanceof Response) {
      logAuthFailure(request.url, hasAuthHeader, hasShopParam, requestId);
      throw new ApiError(401, "Auth redirect — session token or shop context missing", {
        code: "UNAUTHORIZED",
        details: { hasAuthHeader, hasShopParam },
      });
    }

    if (!auth?.session?.shop) {
      logAuthFailure(request.url, hasAuthHeader, hasShopParam, requestId);
      throw new ApiError(401, "Unauthorized (shop not resolved)", {
        code: "UNAUTHORIZED",
        details: { hasAuthHeader, hasShopParam },
      });
    }

    return { admin: auth.admin, session: auth.session };

  } catch (e) {
    if (e instanceof ApiError) throw e;

    // authenticate.admin() sometimes throws a Response directly.
    if (e instanceof Response) {
      logAuthFailure(request.url, hasAuthHeader, hasShopParam, requestId);
      throw new ApiError(401, "Auth redirect — session token or shop context missing", {
        code: "UNAUTHORIZED",
        details: { hasAuthHeader, hasShopParam },
      });
    }

    // Anything else (network error, unexpected throw) → 401, not 502.
    logAuthFailure(request.url, hasAuthHeader, hasShopParam, requestId);
    throw new ApiError(401, "Authentication required", {
      code: "UNAUTHORIZED",
      details: { hasAuthHeader, hasShopParam },
    });
  }
}

// ---------------------------------------------------------------------------
// jsonOk / jsonFail
// ---------------------------------------------------------------------------

/**
 * @param {unknown} data
 * @param {ResponseInit} [init]
 * @param {{ requestId?: string }} [opts]
 * @returns {Response}
 */
export function jsonOk(data, init = {}, opts = {}) {
  const body = { ok: true, data };
  if (opts.requestId) body.meta = { requestId: opts.requestId };
  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status ?? 200,
    headers: {
      ...JSON_HEADERS,
      ...init.headers,
      // Set x-request-id header so clients can read it from any response
      // (including non-JSON fallback paths — e.g. before body is parsed).
      ...(opts.requestId ? { "x-request-id": opts.requestId } : {}),
    },
  });
}

/**
 * @param {{ message: string; code?: string; details?: unknown }} error
 * @param {ResponseInit} [init]
 * @param {{ requestId?: string }} [opts]
 * @returns {Response}
 */
export function jsonFail(error, init = {}, opts = {}) {
  const body = {
    ok: false,
    error: {
      message: error.message,
      ...(error.code != null && { code: error.code }),
      ...(error.details != null && { details: error.details }),
    },
  };
  if (opts.requestId) body.meta = { requestId: opts.requestId };
  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status ?? 500,
    headers: {
      ...JSON_HEADERS,
      ...init.headers,
      ...(opts.requestId ? { "x-request-id": opts.requestId } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// apiRoute
// ---------------------------------------------------------------------------

/**
 * Wraps a loader or action handler so EVERY response is application/json.
 * Catches all errors (including thrown Response and ApiError) and returns
 * jsonFail — preventing any HTML 502 from escaping to the client.
 *
 * Also injects the x-request-id header onto successful handler responses that
 * pass the JSON content-type check, so every /api/* response carries it.
 *
 * @param {(args: { request: Request; params?: Record<string, string> }) => Promise<Response>} handler
 * @returns {(args: { request: Request; params?: Record<string, string> }) => Promise<Response>}
 */
export function apiRoute(handler) {
  return async ({ request, params }) => {
    const requestId = makeRequestId(request);
    try {
      const response = await handler({ request, params });

      if (!(response instanceof Response)) {
        return jsonFail(
          { message: "Handler did not return a Response", code: "INTERNAL" },
          { status: 500 },
          { requestId }
        );
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        // Handler returned non-JSON — wrap it so clients never see HTML.
        return jsonFail(
          { message: "Internal: response was not JSON", code: "INTERNAL" },
          { status: 500 },
          { requestId }
        );
      }

      // Inject x-request-id header onto successful handler responses.
      if (!response.headers.has("x-request-id") && requestId) {
        const headers = new Headers(response.headers);
        headers.set("x-request-id", requestId);
        return new Response(response.body, { status: response.status, headers });
      }

      return response;

    } catch (e) {
      if (e instanceof ApiError) {
        return jsonFail(
          { message: e.message, code: e.code, details: e.details },
          { status: e.status },
          { requestId }
        );
      }
      if (e instanceof Response) {
        // Thrown Response (e.g. redirect from authenticate.admin) — must not escape.
        return jsonFail(
          { message: "Auth redirect or unexpected response", code: "UNAUTHORIZED" },
          { status: 401 },
          { requestId }
        );
      }
      // Unexpected error — log and return 500 JSON (never 502 HTML).
      logServerError("apiRoute", e instanceof Error ? e : new Error(String(e)), { requestId });
      return jsonFail(
        { message: e?.message ?? "Internal server error", code: "INTERNAL" },
        { status: 500 },
        { requestId }
      );
    }
  };
}
