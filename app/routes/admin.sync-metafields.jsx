/**
 * Sync metafields: run definition sync + pin Title/Miles, list products missing Miles or Title (for older vehicles).
 */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createVehicleMetafieldDefinitions } from "../services/metafield-definitions.server.js";
import { runGraphQL } from "../lib/shopify-graphql.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const listMissing = url.searchParams.get("list") === "1";
  const shop = session?.shop ?? "";

  const synced = await createVehicleMetafieldDefinitions(admin);
  let missing = [];

  if (listMissing) {
    const graphql = admin.graphql;
    const query = `#graphql
      query vehiclesWithMetafields($after: String) {
        products(first: 100, query: "product_type:Vehicles", after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            metafields(namespace: "vin_decoder", first: 20) { key value }
          }
        }
      }
    `;
    const collected = [];
    let after = null;
    for (let page = 0; page < 5; page++) {
      const { data } = await runGraphQL(graphql, {
        query,
        variables: after ? { after } : {},
      });
      const nodes = data?.products?.nodes ?? [];
      for (const p of nodes) {
        const mf = (p.metafields ?? []).reduce((acc, m) => {
          acc[m.key] = m?.value ?? "";
          return acc;
        }, {});
        const hasVin = (mf.vin ?? "").toString().trim() !== "";
        const hasMiles = (mf.mileage ?? "").toString().trim() !== "";
        const hasTitle = (mf.title_status ?? "").toString().trim() !== "";
        if (hasVin && (!hasMiles || !hasTitle)) {
          const legacyId = p.id?.replace?.("gid://shopify/Product/", "") ?? "";
          collected.push({
            id: p.id,
            title: p.title ?? "Untitled",
            legacyResourceId: legacyId,
            missingMiles: !hasMiles,
            missingTitle: !hasTitle,
          });
        }
      }
      const endCursor = data?.products?.pageInfo?.endCursor;
      if (!data?.products?.pageInfo?.hasNextPage || !endCursor) break;
      after = endCursor;
    }
    missing = collected;
  }

  return {
    synced: synced.map((r) => ({ key: r.key, name: r.name, status: r.status, error: r.error })),
    missing,
    shop,
    listRequested: listMissing,
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
  const { synced, missing, shop, listRequested } = useLoaderData() ?? {};

  return (
    <s-page heading="Sync metafields">
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
        <fetcher.Form method="get" style={{ margin: "12px 0" }}>
          <input type="hidden" name="list" value="1" />
          <s-button type="submit" variant="primary">
            List products missing Miles or Title
          </s-button>
        </fetcher.Form>

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
