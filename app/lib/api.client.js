/**
 * Unified API client for /api/*. Uses authenticated fetch and enforces JSON envelope.
 * Use for ALL /api calls from the frontend. Returns { ok, data?, error?, meta? }.
 *
 * WHY THIS FIXES INTERMITTENT 401/502:
 *   Shopify's authenticate.admin() resolves shop identity from EITHER the
 *   Authorization: Bearer <session-token> header OR the ?shop=&host= query
 *   parameters. When the session token is temporarily unavailable (App Bridge
 *   race), having shop/host in the URL gives the server a reliable fallback.
 *   buildApiUrl() copies those params from window.location.search into every
 *   /api/* request automatically, without duplicating them if they are already
 *   present.
 */
import { useCallback } from "react";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch.js";

/** Shopify embedded context params we forward from the page URL to /api/* requests. */
const SHOPIFY_CTX_PARAMS = ["shop", "host", "embedded"];

/**
 * Build a fully-qualified URL for an internal /api/* path.
 * Copies Shopify context query params (shop, host, embedded) from the current
 * page URL into the API request URL — only when they are not already present.
 *
 * Handles:
 *   - Paths that already include query strings (e.g. /api/files?first=30)
 *   - Absolute URLs (left untouched — assumed to be external or already correct)
 *   - SSR/non-browser contexts (returns path as-is; server never calls this)
 *
 * @param {string} path - Relative path like "/api/files?first=30" or absolute URL.
 * @returns {string} Fully-qualified URL string with context params appended.
 */
function buildApiUrl(path) {
  // Leave absolute URLs (e.g. external staged-upload targets) unchanged.
  if (path.startsWith("http")) return path;

  // SSR guard — this function only runs client-side.
  if (typeof window === "undefined") return path;

  const url = new URL(path, window.location.origin);

  // Copy each Shopify context param from the current page URL (if not already in path).
  if (window.location.search) {
    const pageParams = new URLSearchParams(window.location.search);
    for (const key of SHOPIFY_CTX_PARAMS) {
      const val = pageParams.get(key);
      if (val && !url.searchParams.has(key)) {
        url.searchParams.set(key, val);
      }
    }
  }

  return url.toString();
}

/**
 * Parse a Response into the unified envelope.
 * @param {Response} res
 * @returns {Promise<Envelope>}
 */
async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  // Prefer x-request-id from response header (set by apiRoute on every response).
  const requestId = res.headers.get("x-request-id") || undefined;

  if (!isJson) {
    const text = await res.text().catch(() => "");
    if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<")) {
      return {
        ok: false,
        error: {
          message: "Server returned a page instead of data. Try refreshing or re-opening the app.",
          code: "BAD_RESPONSE",
        },
        meta: requestId ? { requestId } : undefined,
      };
    }
    return {
      ok: false,
      error: { message: res.statusText || "Request failed", code: "BAD_RESPONSE" },
      meta: requestId ? { requestId } : undefined,
    };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      error: { message: "Invalid response from server.", code: "BAD_RESPONSE" },
      meta: requestId ? { requestId } : undefined,
    };
  }

  if (json && json.ok === false) {
    return {
      ok: false,
      error: {
        message: json.error?.message ?? "Request failed",
        code: json.error?.code,
        details: json.error?.details,
      },
      // Prefer requestId from header, fall back to body meta.
      meta: { ...(json.meta ?? {}), ...(requestId ? { requestId } : {}) },
    };
  }

  if (json && json.ok === true) {
    return {
      ok: true,
      data: json.data,
      meta: { ...(json.meta ?? {}), ...(requestId ? { requestId } : {}) },
    };
  }

  return {
    ok: false,
    error: { message: json?.error?.message ?? "Unexpected response", code: "BAD_RESPONSE" },
    meta: { ...(json?.meta ?? {}), ...(requestId ? { requestId } : {}) },
  };
}

/**
 * Hook that returns apiGet and apiPost for all /api/* calls.
 * Both functions:
 *   1. Build the URL with Shopify context params (shop/host/embedded) forwarded.
 *   2. Attach the session token via useAuthenticatedFetch (with retry on failure).
 *   3. Parse and return the unified JSON envelope.
 *
 * @returns {{ apiGet: (url: string) => Promise<Envelope>, apiPost: (url: string, body: unknown) => Promise<Envelope> }}
 */
export function useApiClient() {
  const authFetch = useAuthenticatedFetch();

  const apiGet = useCallback(
    async (url) => {
      const fullUrl = buildApiUrl(url);
      try {
        const res = await authFetch(fullUrl, { method: "GET" });
        return parseApiResponse(res);
      } catch (err) {
        return {
          ok: false,
          error: { message: err?.message ?? "Network request failed", code: "NETWORK_ERROR" },
        };
      }
    },
    [authFetch]
  );

  const apiPost = useCallback(
    async (url, body) => {
      const fullUrl = buildApiUrl(url);
      try {
        const res = await authFetch(fullUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return parseApiResponse(res);
      } catch (err) {
        return {
          ok: false,
          error: { message: err?.message ?? "Network request failed", code: "NETWORK_ERROR" },
        };
      }
    },
    [authFetch]
  );

  return { apiGet, apiPost };
}

/**
 * Format API error for display in UI (message + requestId for support).
 * @param {{ ok: false; error?: { message?: string; code?: string }; meta?: { requestId?: string } }} result
 * @returns {string}
 */
export function formatApiError(result) {
  if (!result || result.ok) return "";
  const msg = result.error?.message ?? result.error?.code ?? "Request failed";
  const requestId = result.meta?.requestId;
  return requestId ? `${msg} (Request ID: ${requestId})` : msg;
}
