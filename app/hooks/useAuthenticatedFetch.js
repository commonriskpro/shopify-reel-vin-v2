import { useCallback } from "react";

/**
 * Returns a fetch function that adds the Shopify session token (App Bridge CDN)
 * so the app backend can authenticate the request. Use for all /api/* calls
 * from embedded admin UI. Does not use @shopify/app-bridge-react (avoids m.subscribe bug).
 */
export function useAuthenticatedFetch() {
  return useCallback(async (url, options = {}) => {
    const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    let headers = new Headers(options.headers);

    if (typeof window !== "undefined" && typeof window.shopify?.getSessionToken === "function") {
      try {
        const token = await window.shopify.getSessionToken();
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
      } catch (_) {
        // Proceed without token; server will return 401
      }
    }

    if (options.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return fetch(fullUrl, { ...options, headers });
  }, []);
}
