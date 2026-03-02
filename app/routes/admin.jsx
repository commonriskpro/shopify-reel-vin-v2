import { useEffect, useState } from "react";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ensureVinDecoderMetafieldDefinitions } from "../services/metafields.server.js";
import { logServerError } from "../http.server.js";
import "../styles/admin-tokens.css";
import "../styles/admin-theme.css";

export const config = { runtime: "nodejs" };

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const isWebhook = url.pathname.includes("/webhooks/") && request.method === "POST";
  if (isWebhook) {
    const { getValidatedEnv } = await import("../env.server.js");
    return { apiKey: getValidatedEnv().SHOPIFY_API_KEY };
  }
  let admin;
  let session;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (err) {
    if (err instanceof Response) {
      // Preserve Shopify auth/bounce responses instead of turning them into 500s.
      return err;
    }
    logServerError("admin.loader.authenticate", err, {
      requestUrl: request.url,
      method: request.method,
      headers: {
        host: request.headers.get("host"),
        "x-forwarded-host": request.headers.get("x-forwarded-host"),
        "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
        "x-shopify-shop-domain": request.headers.get("x-shopify-shop-domain"),
      },
    });
    throw err;
  }
  // Don't block app rendering if metafield bootstrap has transient API issues.
  try {
    await ensureVinDecoderMetafieldDefinitions(admin);
  } catch (err) {
    logServerError("admin.loader.ensureMetafields", err, { shop: session?.shop });
  }
  const { getValidatedEnv } = await import("../env.server.js");
  return { apiKey: getValidatedEnv().SHOPIFY_API_KEY };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const [showFallback, setShowFallback] = useState(true);

  useEffect(() => {
    setShowFallback(false);
  }, []);

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* Visible fallback only until app has mounted, so iframe is never fully blank */}
      {showFallback && (
        <div
          className="admin-fallback"
          style={{
            padding: "1.5rem 2rem",
            fontSize: "1rem",
            color: "#202223",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#fff",
            minHeight: "5rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
          data-app-fallback
          aria-live="polite"
          aria-busy="true"
        >
          <span
            className="admin-fallback-spinner"
            style={{
              width: 20,
              height: 20,
              border: "2px solid #e3e3e3",
              borderTopColor: "#5c5f62",
              borderRadius: "50%",
              animation: "admin-spin 0.7s linear infinite",
            }}
            aria-hidden
          />
          <span><strong>VIN Decoder</strong> <span style={{ color: "#6d7175" }}>Loading…</span></span>
        </div>
      )}
      <s-app-nav>
        <s-link href="/admin">VIN Decoder</s-link>
        <s-link href="/admin/add-product">Add product (full)</s-link>
        <s-link href="/admin/reels">Shoppable Reels</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isRedirect =
    error?.constructor?.name === "ErrorResponse" ||
    error?.constructor?.name === "ErrorResponseImpl";
  if (isRedirect) return boundary.error(error);
  return (
    <div
      role="alert"
      style={{
        padding: "2rem 2rem 3rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#202223",
        maxWidth: "36rem",
        margin: "0 auto",
      }}
    >
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h2>
      <p style={{ margin: "0 0 1.5rem", color: "#6d7175", fontSize: "0.9375rem" }}>
        The app hit an error. You can try reopening it from Shopify Admin or refreshing the page.
      </p>
      <a
        href="/admin"
        style={{
          display: "inline-block",
          padding: "0.5rem 1rem",
          background: "#008060",
          color: "#fff",
          borderRadius: "8px",
          textDecoration: "none",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
      >
        Back to app
      </a>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
