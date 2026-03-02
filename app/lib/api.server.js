/**
 * Central API route utilities. Every /api/* route MUST use these so responses
 * are always application/json (no redirects, no HTML 502).
 */
import { authenticate } from "../shopify.server";
import { logServerError } from "../http.server.js";
import { makeRequestId as makeRequestIdFromEnvelope, MAX_JSON_BODY_BYTES } from "./api-envelope.js";

/** Re-export for single import in API routes. */
export const makeRequestId = makeRequestIdFromEnvelope;

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Default max JSON body size for parseJsonBody (100KB). */
export const DEFAULT_MAX_JSON_BODY_BYTES = MAX_JSON_BODY_BYTES;

/**
 * API error with status code. Thrown by requireAdmin or services; apiRoute maps to jsonFail.
 */
export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status (401, 400, 404, 502, etc.)
   * @param {string} message - Short message for error.message
   * @param {{ code?: string; details?: unknown }} [details]
   */
  constructor(status, message, details = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = details?.code ?? (status === 401 ? "UNAUTHORIZED" : "ERROR");
    this.details = details?.details;
  }
}

/**
 * Parse JSON body with size guard. Use for POST/PUT/PATCH actions.
 * @param {Request} request
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<unknown>} Parsed JSON
 * @throws {ApiError} 413 if Content-Length > maxBytes; 400 if body is not valid JSON
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

/**
 * Require admin auth. Never redirects; throws ApiError(401) if session/shop missing.
 * @param {Request} request
 * @returns {Promise<{ admin: import("@shopify/shopify-api").AdminApiContext; session: import("@shopify/shopify-api").Session }>}
 * @throws {ApiError}
 */
export async function requireAdmin(request) {
  try {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) {
      throw new ApiError(401, "Auth failed", { code: "UNAUTHORIZED" });
    }
    if (!auth?.session?.shop) {
      throw new ApiError(401, "Unauthorized (missing shop)", { code: "UNAUTHORIZED" });
    }
    return { admin: auth.admin, session: auth.session };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Response) {
      throw new ApiError(401, "Auth failed", { code: "UNAUTHORIZED" });
    }
    throw new ApiError(401, "Authentication required", { code: "UNAUTHORIZED" });
  }
}

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
    headers: { ...JSON_HEADERS, ...init.headers },
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
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

/**
 * Wraps a loader or action handler so every response is application/json.
 * Catches all errors (including thrown Response) and returns jsonFail.
 * @param {(args: { request: Request; params?: Record<string, string> }) => Promise<Response>} handler
 * @returns {(args: { request: Request; params?: Record<string, string> }) => Promise<Response>}
 */
export function apiRoute(handler) {
  return async ({ request, params }) => {
    const requestId = makeRequestId(request);
    try {
      const response = await handler({ request, params });
      if (!(response instanceof Response)) {
        return jsonFail({ message: "Handler did not return a Response" }, { status: 500 }, { requestId });
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const body = await response.text();
        return jsonFail(
          { message: "Internal: response was not JSON", code: "INTERNAL" },
          { status: 500 },
          { requestId }
        );
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
        return jsonFail({ message: "Auth redirect or unexpected response", code: "UNAUTHORIZED" }, { status: 401 }, { requestId });
      }
      logServerError("apiRoute", e instanceof Error ? e : new Error(String(e)), { requestId });
      return jsonFail(
        { message: e?.message ?? "Internal server error", code: "INTERNAL" },
        { status: 500 },
        { requestId }
      );
    }
  };
}
