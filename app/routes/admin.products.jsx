/**
 * admin.products — Full product list (like Shopify Admin Products).
 * Preserve embed params: links use current search params so the app stays in embedded context.
 */
import { Link, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listProductsForAdmin } from "../services/products.server.js";
import { logServerError } from "../http.server.js";
import "../styles/admin.add-product.css";

function productAdminUrl(shop, legacyResourceId) {
  if (!shop || !legacyResourceId) return null;
  const store = (shop || "").replace(".myshopify.com", "");
  if (!store) return null;
  return `https://admin.shopify.com/store/${store}/products/${legacyResourceId}`;
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const query = url.searchParams.get("query")?.trim() || null;

  let admin, session;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (err) {
    if (err instanceof Response) return err;
    logServerError("admin.products.loader", err instanceof Error ? err : new Error(String(err)), { path: url.pathname });
    throw err;
  }

  const shop = session?.shop ?? "";
  if (!admin?.graphql) {
    return {
      shop,
      products: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      error: "App session incomplete. Refresh or reopen from Shopify Admin.",
    };
  }

  try {
    const { products, pageInfo } = await listProductsForAdmin(admin, {
      first: 50,
      after,
      query: query || undefined,
    });
    return { shop, products, pageInfo, error: null };
  } catch (err) {
    logServerError("admin.products.list", err instanceof Error ? err : new Error(String(err)), { shop });
    return {
      shop,
      products: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      error: "Could not load products. Try again or open Products in Shopify Admin.",
    };
  }
};

export default function AdminProductsPage() {
  const { shop, products, pageInfo, error } = useLoaderData() ?? {};
  const [searchParams] = useSearchParams();
  const preserveQs = searchParams.toString() ? `?${searchParams.toString()}` : "";

  return (
    <s-page heading="Products" size="large">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" style={{ flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
          <s-text tone="subdued">
            <Link to={`/admin${preserveQs}`} style={{ color: "var(--p-color-text-link, #2c6ecb)", textDecoration: "none" }}>App</Link>
            <span> › Products</span>
          </s-text>
          <Link to={`/admin/add-product${preserveQs}`}>
            <s-button variant="primary">Add product</s-button>
          </Link>
        </s-stack>

        <s-section>
          {error && (
            <s-banner tone="critical" slot="before">
              {error}
            </s-banner>
          )}

          {!error && (
            <div className="admin-products-table-wrap" style={{ overflow: "auto" }}>
              <table className="admin-products-table">
                <thead>
                  <tr>
                    <th style={{ width: "52px" }} />
                    <th>Product</th>
                    <th style={{ width: "100px" }}>Status</th>
                    <th style={{ width: "140px" }}>Inventory</th>
                    <th style={{ width: "160px" }}>Category</th>
                    <th style={{ width: "80px" }}>Channels</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 && !error && (
                    <tr>
                      <td colSpan={6} style={{ padding: "32px", textAlign: "center", color: "#6d7175" }}>
                        No products yet. <Link to={`/admin/add-product${preserveQs}`}>Add product</Link> to get started.
                      </td>
                    </tr>
                  )}
                  {products.map((p) => {
                    const openInShopifyUrl = productAdminUrl(shop, p.legacyResourceId);
                    const editorUrl = `/admin/product/${p.legacyResourceId}${preserveQs}`;
                    return (
                      <tr key={p.id}>
                        <td>
                          {p.featuredImageUrl ? (
                            <img
                              src={p.featuredImageUrl}
                              alt=""
                              width={40}
                              height={40}
                              style={{ objectFit: "cover", borderRadius: "6px" }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                background: "#f1f1f1",
                                borderRadius: "6px",
                              }}
                            />
                          )}
                        </td>
                        <td>
                          <Link
                            to={editorUrl}
                            style={{ color: "#2c6ecb", fontWeight: 500, textDecoration: "none" }}
                          >
                            {p.title}
                          </Link>
                          {openInShopifyUrl && (
                            <span style={{ marginLeft: "8px", fontSize: "12px" }}>
                              <a href={openInShopifyUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#6d7175" }} title="Open in Shopify">
                                ↗
                              </a>
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            className="admin-products-status"
                            data-status={p.status?.toLowerCase()}
                          >
                            {p.status === "ACTIVE" ? "Active" : p.status === "DRAFT" ? "Draft" : p.status === "ARCHIVED" ? "Archived" : p.status}
                          </span>
                        </td>
                        <td style={{ color: "#6d7175", fontSize: "13px" }}>{p.inventoryDisplay}</td>
                        <td style={{ color: "#6d7175", fontSize: "13px" }}>{p.categoryName || p.productType || "—"}</td>
                        <td style={{ color: "#6d7175", fontSize: "13px" }}>{p.channelsCount ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!error && pageInfo?.hasNextPage && pageInfo?.endCursor && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e1e3e5" }}>
              <Link
                to={`/admin/products?${new URLSearchParams({ ...Object.fromEntries(searchParams), after: pageInfo.endCursor }).toString()}`}
                style={{ color: "var(--p-color-text-link, #2c6ecb)", fontSize: "14px" }}
              >
                Load more
              </Link>
            </div>
          )}
        </s-section>

        <s-paragraph tone="subdued">
          Click a product name to edit in the app. Use the ↗ icon next to a product to open it in Shopify Admin.
        </s-paragraph>
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
