/**
 * Unified API client hook: useApiClient() + formatApiError().
 *
 * SSR SAFETY NOTE — DO NOT RENAME THIS FILE WITH A ".client." INFIX.
 *   Files named *.client.* are treated as browser-only modules by the
 *   Vite / React Router build pipeline and are STRIPPED from the server
 *   bundle. Any server-rendered route that imports from a *.client.* file
 *   will receive undefined exports, causing "useApiClient is not a function"
 *   during SSR and a production crash (verified: Vercel TypeError at Index).
 *
 *   This file MUST stay importable on the server. All browser-only code
 *   (window, document, App Bridge) lives exclusively inside callback bodies
 *   that are only invoked client-side, never at module evaluation time.
 *
 * @module useApiClient
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
 * SSR-safe: returns path unchanged when window is not available.
 *
 * @param {string} path - Relative path like "/api/files?first=30" or absolute URL.
 * @returns {string}
 */
function buildApiUrl(path) {
  if (path.startsWith("http")) return path;
  // SSR guard — window is not available during server-side rendering.
  if (typeof window === "undefined") return path;

  const url = new URL(path, window.location.origin);
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
 * @returns {Promise<import("./api-envelope.js").Envelope>}
 */
async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const requestId = res.headers.get("x-request-id") || undefined;

  if (!isJson) {
    const text = await res.text().catch(() => "");
    if (text.trimStart().startsWith("<")) {
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

  if (json?.ok === false) {
    return {
      ok: false,
      error: {
        message: json.error?.message ?? "Request failed",
        code: json.error?.code,
        details: json.error?.details,
      },
      meta: { ...(json.meta ?? {}), ...(requestId ? { requestId } : {}) },
    };
  }

  if (json?.ok === true) {
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
 * Hook that returns apiGet and apiPost for /api/* calls.
 *
 * SSR-safe: useCallback bodies reference window only inside async callbacks
 * that are never invoked during server rendering.
 *
 * @returns {{ apiGet: (url: string) => Promise<object>, apiPost: (url: string, body: unknown) => Promise<object> }}
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
 * Format an API error envelope into a human-readable string for UI display.
 * @param {{ ok: false; error?: { message?: string; code?: string }; meta?: { requestId?: string } }} result
 * @returns {string}
 */
export function formatApiError(result) {
  if (!result || result.ok) return "";
  const msg = result.error?.message ?? result.error?.code ?? "Request failed";
  const requestId = result.meta?.requestId;
  return requestId ? `${msg} (Request ID: ${requestId})` : msg;
}
