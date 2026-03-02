import { useCallback } from "react";

/**
 * Returns a fetch function that adds the Shopify session token (App Bridge CDN)
 * so the app backend can authenticate /api/* requests.
 *
 * WHY THIS FIXES INTERMITTENT 401/502:
 *   window.shopify.getSessionToken() can fail or return null during the brief
 *   App Bridge initialization window. A single call that silently swallows the
 *   error leaves the Authorization header absent, causing authenticate.admin()
 *   to see shop:null and return a redirect — which apiRoute converts to a 502.
 *   Adding retry+backoff gives App Bridge time to finish setting up, so the
 *   token is reliably attached on every real embedded-admin request.
 */

const MAX_TOKEN_ATTEMPTS = 3;
const TOKEN_RETRY_DELAY_MS = 150; // 150 * (attempt+1) → max ~450ms total extra wait

/**
 * Try window.shopify.getSessionToken() up to MAX_TOKEN_ATTEMPTS times.
 * Returns the token string or null if all attempts fail.
 * @returns {Promise<string | null>}
 */
async function getSessionTokenWithRetry() {
  if (
    typeof window === "undefined" ||
    typeof window.shopify?.getSessionToken !== "function"
  ) {
    return null;
  }

  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
    try {
      const token = await window.shopify.getSessionToken();
      if (token) return token;
    } catch (_) {
      // Token not ready yet; retry after delay
    }
    if (attempt < MAX_TOKEN_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, TOKEN_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Returns an authenticated fetch function for all /api/* calls.
 * Falls back gracefully (no token) so the request still goes through — the
 * server will return a structured 401 JSON (not an HTML 502) if auth fails.
 */
export function useAuthenticatedFetch() {
  return useCallback(async (url, options = {}) => {
    // Accept pre-built full URLs from useApiClient.js (which already appends shop/host).
    const fullUrl = url.startsWith("http")
      ? url
      : `${window.location.origin}${url}`;

    const headers = new Headers(options.headers);

    // Attach session token with retry so App Bridge race conditions don't cause silent auth failure.
    const token = await getSessionTokenWithRetry();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    // If still no token, proceed anyway — shop/host query params (added by
    // buildApiUrl in useApiClient.js) give the server a second chance to resolve auth,
    // and if it still fails the server returns a deterministic 401 JSON.

    if (options.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return fetch(fullUrl, { ...options, headers });
  }, []);
}
