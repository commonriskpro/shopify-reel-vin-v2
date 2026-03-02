/**
 * Unified API client for /api/*. Uses authenticated fetch and enforces JSON envelope.
 * Use for ALL /api calls from the frontend. Returns { ok, data?, error?, meta? }; includes requestId in errors.
 */
import { useCallback } from "react";
import { useAuthenticatedFetch } from "../hooks/useAuthenticatedFetch.js";

/**
 * Parse a Response into the unified envelope. Use after authenticated fetch.
 * @param {Response} res
 * @returns {Promise<{ ok: true; data: unknown; meta?: { requestId?: string; warnings?: Array<{ code: string; message: string }> } } | { ok: false; error: { message: string; code?: string; details?: unknown }; meta?: { requestId?: string } }>}
 */
async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const requestId = res.headers.get("x-request-id") || undefined;

  if (!isJson) {
    const text = await res.text().catch(() => "");
    if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<")) {
      return {
        ok: false,
        error: { message: "Server returned a page instead of data. Try refreshing or re-opening the app.", code: "BAD_RESPONSE" },
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
      meta: json.meta ?? (requestId ? { requestId } : undefined),
    };
  }

  if (json && json.ok === true) {
    return {
      ok: true,
      data: json.data,
      meta: json.meta ?? (requestId ? { requestId } : undefined),
    };
  }

  return {
    ok: false,
    error: { message: json?.error?.message ?? "Unexpected response", code: "BAD_RESPONSE" },
    meta: json?.meta ?? (requestId ? { requestId } : undefined),
  };
}

/**
 * Hook that returns apiGet and apiPost using authenticated fetch. Use for all /api/* calls.
 * @returns {{ apiGet: (url: string) => Promise<Envelope>, apiPost: (url: string, body: unknown) => Promise<Envelope> }}
 */
export function useApiClient() {
  const authFetch = useAuthenticatedFetch();

  const apiGet = useCallback(
    async (url) => {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
      try {
        const res = await authFetch(fullUrl, { method: "GET" });
        return parseApiResponse(res);
      } catch (err) {
        return {
          ok: false,
          error: {
            message: err?.message ?? "Network request failed",
            code: "NETWORK_ERROR",
          },
        };
      }
    },
    [authFetch]
  );

  const apiPost = useCallback(
    async (url, body) => {
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
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
          error: {
            message: err?.message ?? "Network request failed",
            code: "NETWORK_ERROR",
          },
        };
      }
    },
    [authFetch]
  );

  return { apiGet, apiPost };
}

/**
 * Format API error for display (message + requestId).
 * @param {{ ok: false; error?: { message?: string; code?: string }; meta?: { requestId?: string } }} result
 * @returns {string}
 */
export function formatApiError(result) {
  if (!result || result.ok) return "";
  const msg = result.error?.message ?? result.error?.code ?? "Request failed";
  const requestId = result.meta?.requestId;
  return requestId ? `${msg} (Request ID: ${requestId})` : msg;
}
