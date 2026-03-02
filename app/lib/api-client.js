/**
 * Client helper for /api envelope parsing. Use for all UI calls to /api/*.
 * Returns { ok, data?, error?, meta? }; normalizes network/non-JSON to client error.
 */

/**
 * @param {string} url - full URL or path (path is resolved against window.location.origin when in browser)
 * @param {RequestInit} [options]
 * @returns {Promise<{ ok: true; data: unknown; meta?: { requestId?: string; warnings?: Array<{ code: string; message: string }> } } | { ok: false; error: { code: string; message: string }; meta?: { requestId?: string } }>}
 */
export async function apiFetch(url, options = {}) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const fullUrl = url.startsWith("http") ? url : `${base}${url}`;

  let res;
  try {
    const headers = { ...options.headers };
    if (options.body != null && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    res = await fetch(fullUrl, { ...options, headers });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: err?.message ?? "Network request failed",
      },
    };
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!isJson) {
    const text = await res.text().catch(() => "");
    if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<")) {
      return {
        ok: false,
        error: { code: "BAD_RESPONSE", message: "Server returned a page instead of data. Try refreshing." },
        meta: res.headers.get("x-request-id") ? { requestId: res.headers.get("x-request-id") } : undefined,
      };
    }
    return {
      ok: false,
      error: { code: "BAD_RESPONSE", message: res.statusText || "Request failed" },
      meta: res.headers.get("x-request-id") ? { requestId: res.headers.get("x-request-id") } : undefined,
    };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      error: { code: "BAD_RESPONSE", message: "Invalid response from server." },
      meta: res.headers.get("x-request-id") ? { requestId: res.headers.get("x-request-id") } : undefined,
    };
  }

  if (json && json.ok === false) {
    return {
      ok: false,
      error: json.error ?? { code: "UNKNOWN", message: "Request failed" },
      meta: json.meta,
    };
  }

  if (json && json.ok === true) {
    return {
      ok: true,
      data: json.data,
      meta: json.meta,
    };
  }

  return {
    ok: false,
    error: { code: "BAD_RESPONSE", message: json?.error?.message ?? json?.error ?? "Unexpected response" },
    meta: json?.meta,
  };
}

/**
 * Normalize warnings from action/API response into a single array of message strings.
 * Handles meta.warnings, inventoryError, and top-level warnings array.
 * @param {unknown} actionData - fetcher.data or action response
 * @returns {string[]}
 */
export function getWarnings(actionData) {
  const list = [];
  const metaWarnings = actionData?.meta?.warnings ?? [];
  metaWarnings.forEach((w) => {
    const msg = typeof w === "string" ? w : w?.message ?? w?.code;
    if (msg) list.push(String(msg));
  });
  if (actionData?.inventoryError) {
    list.push(`inventory could not be set to 1 — ${actionData.inventoryError}`);
  }
  const topWarnings = actionData?.warnings ?? [];
  if (Array.isArray(topWarnings)) {
    topWarnings.forEach((w) => {
      const msg = typeof w === "string" ? w : w?.message ?? w?.code;
      if (msg) list.push(String(msg));
    });
  }
  return list;
}
