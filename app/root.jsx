import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "react-router";

const API_KEY =
  typeof process !== "undefined" ? process.env.SHOPIFY_API_KEY : undefined;

export default function App() {
  const location = useLocation();
  const isAdmin =
    location?.pathname?.startsWith?.("/admin") ||
    location?.pathname?.startsWith?.("/api/auth");
  const addAppBridgeInHead =
    typeof process !== "undefined" && API_KEY && isAdmin;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* App Bridge must read host from URL; meta + first script for embedded admin */}
        {addAppBridgeInHead && (
          <>
            <meta name="shopify-api-key" content={API_KEY} />
            <script
              src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
              data-api-key={API_KEY}
            />
            <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
          </>
        )}
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
