import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

// Allow time for auth and loader; 5s was too short and aborted the stream → blank iframe
export const streamTimeout = 20000;

function base64Encode(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

const DEFAULT_EMBED_CSP =
  "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.spin.dev https://admin.shop.dev;";
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function normalizeShopDomain(rawShop) {
  if (typeof rawShop !== "string") return null;
  let value = rawShop.trim().toLowerCase();
  if (!value) return null;

  // Accept either plain shop domain or full URL.
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  value = value.split("/")[0].split("?")[0].split("#")[0];
  value = value.split(":")[0];
  if (!SHOP_DOMAIN_RE.test(value)) return null;
  return value;
}

function cspForShop(rawShop) {
  const shop = normalizeShopDomain(rawShop);
  if (!shop) return DEFAULT_EMBED_CSP;
  return `frame-ancestors https://${shop} https://admin.shopify.com https://*.spin.dev https://admin.shop.dev;`;
}

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const searchParams = url.searchParams;
  const validatedShop = normalizeShopDomain(searchParams.get("shop"));

  // Embedded app requires "host" for App Bridge; Shopify sometimes omits it. Derive from shop and redirect.
  if (pathname === "/admin" && validatedShop && !searchParams.get("host") && searchParams.get("embedded") === "1") {
    const shop = validatedShop.replace(/\.myshopify\.com$/i, "");
    if (shop) {
      const derivedHost = base64Encode(`${shop}.admin.shopify.com`);
      searchParams.set("host", derivedHost);
      const newUrl = `${url.origin}${pathname}?${searchParams.toString()}`;
      responseHeaders.set("Content-Type", "text/html; charset=utf-8");
      responseHeaders.set("Location", newUrl);
      responseHeaders.set("Content-Security-Policy", DEFAULT_EMBED_CSP);
      return new Response(null, { status: 302, headers: responseHeaders });
    }
  }

  // When App Bridge fetches /admin with X-Shopify-Bounce, we must return 200 with HTML (not 302).
  // If we have no session, redirect the top frame to login so the user can sign in (breaks bounce loop).
  const apiKey = process.env.SHOPIFY_API_KEY;
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  // Login URL must be app origin + /auth/login (application_url often includes /admin)
  let appOrigin = "";
  try {
    if (appUrl) appOrigin = new URL(appUrl).origin;
  } catch (_) {}
  if (!appOrigin && request.headers.get("x-forwarded-host")) {
    const proto = request.headers.get("x-forwarded-proto") || "https";
    appOrigin = `${proto}://${request.headers.get("x-forwarded-host")}`;
  }
  if (!appOrigin && url.origin) appOrigin = url.origin;
  const sendLoginRedirectHtml = (shopParam) => {
    addDocumentResponseHeaders(request, responseHeaders);
    const shop = normalizeShopDomain(shopParam ?? searchParams.get("shop"));
    responseHeaders.set("Content-Security-Policy", cspForShop(shop));
    responseHeaders.set("Content-Type", "text/html; charset=utf-8");
    const loginUrl = `${appOrigin}/auth/login${shop ? `?shop=${encodeURIComponent(shop)}` : ""}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in</title></head><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f6f7;"><p style="color:#202223;">Redirecting to sign in…</p><script>window.top.location.href=${JSON.stringify(loginUrl)};</script></body></html>`;
    return new Response(html, { status: 200, headers: responseHeaders });
  };

  if (pathname === "/admin" && request.method === "GET" && request.headers.get("X-Shopify-Bounce") && apiKey) {
    return sendLoginRedirectHtml();
  }

  const isEmbeddedAdmin = pathname === "/admin" && request.method === "GET" && validatedShop && (searchParams.get("embedded") === "1" || searchParams.get("host"));
  const isEmbeddedAdminAny = pathname === "/admin" && request.method === "GET" && validatedShop;

  // First paint: return static HTML so the iframe is never blank. Then reload with _app=1 to run the real app.
  if (isEmbeddedAdminAny && !searchParams.has("_app")) {
    addDocumentResponseHeaders(request, responseHeaders);
    if (pathname.startsWith("/admin")) responseHeaders.delete("X-Frame-Options");
    responseHeaders.set("Content-Security-Policy", cspForShop(validatedShop));
    responseHeaders.set("Content-Type", "text/html; charset=utf-8");
    const qs = searchParams.toString();
    const nextUrl = `${url.pathname}${qs ? "?" + qs + "&" : "?"}_app=1`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${encodeURI(nextUrl)}"><title>VIN Decoder</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#202223;} .m{font-size:1rem;}</style></head><body><p class="m"><strong>VIN Decoder</strong> – loading…</p><script>try{window.location.replace(${JSON.stringify(nextUrl)});}catch(e){}</script></body></html>`;
    return new Response(html, { status: 200, headers: responseHeaders });
  }

  // Let route loaders own authentication. Pre-auth here can cause duplicate session checks
  // and redirect loops in embedded contexts.

  addDocumentResponseHeaders(request, responseHeaders);
  // Ensure nothing blocks embedding (override any X-Frame-Options from addDocumentResponseHeaders)
  if (pathname.startsWith("/admin")) {
    responseHeaders.delete("X-Frame-Options");
  }

  // Admin and auth must be embeddable in Shopify (frame-ancestors; avoid default deny).
  if (pathname.startsWith("/auth")) {
    responseHeaders.set("Content-Security-Policy", cspForShop(validatedShop));
  } else if (pathname.startsWith("/admin")) {
    responseHeaders.set("Content-Security-Policy", cspForShop(validatedShop));
  }
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    let abortFn;
    // Abort only if the shell doesn't complete in time (avoids blank iframe when auth is slow)
    const timeoutId = setTimeout(() => abortFn?.(), streamTimeout + 2000);

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          clearTimeout(timeoutId);
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          clearTimeout(timeoutId);
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );
    abortFn = abort;
  });
}
