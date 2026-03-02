/**
 * Sync metafields: run definition sync + pin Title/Miles, list products missing Miles or Title (for older vehicles).
 * Full hardening: loader never throws; errors returned as data and shown in UI; structured logging for Vercel.
 */
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createVehicleMetafieldDefinitions } from "../services/metafield-definitions.server.js";
import { listProductsMissingMilesOrTitle } from "../services/products.server.js";
import { syncMetafieldsLog, syncMetafieldsError } from "../lib/sync-metafields-debug.server.js";
import { logServerError } from "../http.server.js";

const EMPTY_STATE = {
  synced: [],
  missing: [],
  shop: "",
  listRequested: false,
  error: null,
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const listMissing = url.searchParams.get("list") === "1";

  let admin;
  let session;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (err) {
    if (err instanceof Response) return err;
    syncMetafieldsError("loader.authenticate", err, { path: url.pathname });
    logServerError("admin.sync-metafields.authenticate", err instanceof Error ? err : new Error(String(err)), { path: url.pathname });
    return { ...EMPTY_STATE, listRequested: listMissing, error: "Authentication failed. Try reopening the app from Shopify Admin or refreshing the page." };
  }

  const shop = session?.shop ?? null;
  syncMetafieldsLog("loader.start", { shop: shop ?? "null", listMissing });

  if (!shop) {
    syncMetafieldsError("loader.shop_null", new Error("Session has no shop"), { path: url.pathname });
    return { ...EMPTY_STATE, listRequested: listMissing, error: "Store not identified. Open the app again from Shopify Admin (Apps → reel-vin-v2)." };
  }

  if (!admin?.graphql) {
    syncMetafieldsError("loader.no_admin", new Error("No admin GraphQL"), { shop });
    return { ...EMPTY_STATE, shop, listRequested: listMissing, error: "App session incomplete. Refresh the page or reopen from Shopify Admin." };
  }

  let synced;
  try {
    synced = await createVehicleMetafieldDefinitions(admin);
    syncMetafieldsLog("loader.definitions_done", { shop, count: synced?.length ?? 0, errors: synced?.filter((r) => r.status === "error").length ?? 0 });
  } catch (err) {
    syncMetafieldsError("loader.definitions", err, { shop });
    logServerError("admin.sync-metafields.definitions", err instanceof Error ? err : new Error(String(err)), { shop });
    return { ...EMPTY_STATE, shop, listRequested: listMissing, error: "Could not sync metafield definitions. See server logs. You can try again or use Filter Setup to create definitions." };
  }

  let missing = [];
  if (listMissing) {
    try {
      missing = await listProductsMissingMilesOrTitle(admin);
      syncMetafieldsLog("loader.list_done", { shop, missingCount: missing.length });
    } catch (err) {
      syncMetafieldsError("loader.list_products", err, { shop });
      logServerError("admin.sync-metafields.list_products", err instanceof Error ? err : new Error(String(err)), { shop });
      return {
        synced: synced.map((r) => ({ key: r.key, name: r.name, status: r.status, error: r.error })),
        missing: [],
        shop,
        listRequested: true,
        error: "Definitions synced, but listing products failed. Try again or edit products directly in Shopify Admin.",
      };
    }
  }

  return {
    synced: synced.map((r) => ({ key: r.key, name: r.name, status: r.status, error: r.error })),
    missing,
    shop,
    listRequested: listMissing,
    error: null,
  };
};

function AdminProductLink({ shop, legacyResourceId, children }) {
  const href = `https://${shop}/admin/products/${legacyResourceId}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#2c6ecb" }}>
      {children}
    </a>
  );
}

export default function SyncMetafieldsPage() {
  const loaderData = useLoaderData() ?? {};
  const fetcher = useFetcher();
  // When "List products" is clicked we load via fetcher (same session, no full-page nav that triggers auth redirect)
  const data = fetcher.data ?? loaderData;
  const { synced, missing, shop, listRequested, error } = data;

  return (
    <s-page heading="Sync metafields">
      {error && (
        <s-banner tone="critical" style={{ marginBottom: 16 }}>
          {error}
          <br />
          <a href="/admin/sync-metafields" style={{ marginTop: 8, display: "inline-block", color: "#fff", textDecoration: "underline" }}>Try again</a>
        </s-banner>
      )}
      <s-section heading="Definitions and product admin">
        <s-paragraph>
          Metafield definitions are synced when you open the app. <strong>Title</strong> and{" "}
          <strong>Miles</strong> are pinned so they appear in the Shopify product admin under
          Product metafields — you can edit them on any product like standard fields.
        </s-paragraph>
        <s-paragraph>
          Theme and app both use <code>vin_decoder.title_status</code> and{" "}
          <code>vin_decoder.mileage</code>; the theme shows them in the vehicle specs block.
        </s-paragraph>
      </s-section>

      <s-section heading="Products missing Miles or Title (older vehicles)">
        <s-paragraph>
          Click below to list vehicles that have a VIN but are missing Miles or Title. Open each
          product in Shopify admin to add the values.
        </s-paragraph>
        <s-button
          type="button"
          variant="primary"
          disabled={fetcher.state === "loading"}
          onClick={() => fetcher.load("/admin/sync-metafields?list=1")}
          {...(fetcher.state === "loading" ? { loading: true } : {})}
          style={{ margin: "12px 0" }}
        >
          {fetcher.state === "loading" ? "Loading…" : "List products missing Miles or Title"}
        </s-button>

        {missing && missing.length > 0 && (
          <div style={{ marginTop: 16, border: "1px solid #e3e3e3", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", background: "#f6f6f7", fontWeight: 600, fontSize: 13 }}>
              {missing.length} product(s) missing Miles or Title
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {missing.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderBottom: "1px solid #f1f1f1",
                  }}
                >
                  <AdminProductLink shop={shop} legacyResourceId={p.legacyResourceId}>
                    {p.title}
                  </AdminProductLink>
                  <span style={{ fontSize: 11, color: "#6d7175" }}>
                    {p.missingMiles && "No Miles"}
                    {p.missingMiles && p.missingTitle && " · "}
                    {p.missingTitle && "No Title"}
                  </span>
                  <a
                    href={`https://${shop}/admin/products/${p.legacyResourceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: "#2c6ecb" }}
                  >
                    Edit in Shopify →
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {listRequested && missing && missing.length === 0 && (
          <s-banner tone="success">No vehicles found that are missing Miles or Title.</s-banner>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
