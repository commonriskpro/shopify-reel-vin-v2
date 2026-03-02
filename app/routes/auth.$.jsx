import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const BOUNCE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#202223;background:#f6f6f7;}</style></head>
<body><p>Redirecting to complete sign-in…</p>`;

// Fallback: if still in iframe after 3s, redirect top to login (handles bounce/extension failures).
function fallbackRedirectScript(loginUrl) {
  return `<script>
(function(){
  var u = ${JSON.stringify(loginUrl)};
  setTimeout(function(){ try { if (window.top !== window) window.top.location.href = u; } catch(e) {} }, 3000);
})();
</script>`;
}

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
    return null;
  } catch (error) {
    if (error instanceof Response) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/auth/session-token")) {
        const contentType = error.headers.get("content-type") || "";
        const shop = url.searchParams.get("shop");
        const appOrigin = typeof process !== "undefined" && process.env.SHOPIFY_APP_URL
          ? new URL(process.env.SHOPIFY_APP_URL).origin
          : (request.headers.get("x-forwarded-host") ? (request.headers.get("x-forwarded-proto") || "https") + "://" + request.headers.get("x-forwarded-host") : "");
        const loginUrl = appOrigin ? `${appOrigin}/auth/login${shop ? "?shop=" + encodeURIComponent(shop) : ""}` : "";
        if (contentType.includes("text/html")) {
          const scriptBody = await error.text();
          const fullHtml = `${BOUNCE_HTML}${scriptBody}${loginUrl ? fallbackRedirectScript(loginUrl) : ""}</body></html>`;
          return new Response(fullHtml, {
            status: error.status,
            headers: error.headers,
          });
        }
        // Not HTML (e.g. redirect): still return visible HTML + fallback so iframe isn't blank
        if (error.status >= 300 && error.status < 400 && loginUrl) {
          const html = `${BOUNCE_HTML}<script>try{window.top.location.href=${JSON.stringify(loginUrl)};}catch(e){}</script>${fallbackRedirectScript(loginUrl)}</body></html>`;
          const headers = new Headers(error.headers);
          headers.set("Content-Type", "text/html; charset=utf-8");
          return new Response(html, { status: 200, headers });
        }
      }
    }
    throw error;
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
