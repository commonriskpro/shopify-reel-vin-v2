/**
 * admin.product.$productId — In-app product editor (same layout as Add product, edit mode).
 * Opens when you click a product in the Products list. Preserve embed params on links.
 */
import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useParams, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { getCategoriesForVehicles } from "../services/categories.server.js";
import { getProductForEditor, updateProduct } from "../services/products.server.js";
import { MediaPicker } from "../components/MediaPicker.jsx";
import "../styles/admin.add-product.css";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
  { value: "ARCHIVED", label: "Archived" },
];

function productAdminUrl(shop, productIdGid) {
  if (!shop || !productIdGid) return null;
  const numericId = productIdGid.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!numericId) return null;
  return `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${numericId}`;
}

const actionSchema = z.object({
  intent: z.literal("update"),
  title: z.string().optional(),
  descriptionHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tagsString: z.string().optional(),
  status: z.string().optional(),
  categoryId: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  compareAtPrice: z.union([z.string(), z.number()]).optional(),
  cost: z.union([z.string(), z.number()]).optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  titleStatus: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional(),
  sellWhenOutOfStock: z.boolean().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
}).passthrough();

export const loader = async ({ request, params }) => {
  const { productId: legacyId } = params;
  if (!legacyId) return { product: null, shop: "", categories: [], error: "Missing product id" };

  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  let categories = [];
  let defaultCategoryId = "";
  try {
    const cat = await getCategoriesForVehicles(admin);
    categories = cat.categories;
    defaultCategoryId = cat.defaultCategoryId ?? "";
  } catch (_) {}

  const product = await getProductForEditor(admin, legacyId);
  if (!product) {
    return { product: null, shop, categories, error: "Product not found. It may have been deleted." };
  }
  return { product, shop, categories, defaultCategoryId, error: null };
};

export const action = async ({ request, params }) => {
  if (request.method !== "POST") return null;
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const { productId: legacyId } = params;
  if (!legacyId) return Response.json({ error: "Missing product id" }, { status: 400 });

  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success || parsed.data.intent !== "update") {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const data = parsed.data;
  const productIdGid = legacyId.startsWith("gid://") ? legacyId : `gid://shopify/Product/${legacyId.replace(/\D/g, "")}`;

  try {
    await updateProduct(admin, productIdGid, {
      title: data.title,
      descriptionHtml: data.descriptionHtml,
      vendor: data.vendor,
      productType: data.productType,
      tagsString: data.tagsString,
      status: data.status,
      categoryId: data.categoryId,
      price: data.price,
      compareAtPrice: data.compareAtPrice,
      cost: data.cost,
      sku: data.sku,
      barcode: data.barcode,
      titleStatus: data.titleStatus,
      mileage: data.mileage,
      sellWhenOutOfStock: data.sellWhenOutOfStock,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err?.message ?? "Update failed" }, { status: 500 });
  }
};

export default function ProductEditorPage() {
  const { product, shop, categories, error: loadError } = useLoaderData() ?? {};
  const params = useParams();
  const [searchParams] = useSearchParams();
  const preserveQs = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const fetcher = useFetcher();
  const [title, setTitle] = useState(product?.title ?? "");
  const [descriptionHtml, setDescriptionHtml] = useState(product?.descriptionHtml ?? "");
  const [vendor, setVendor] = useState(product?.vendor ?? "");
  const [productType, setProductType] = useState(product?.productType ?? "Vehicles");
  const [tagsString, setTagsString] = useState(Array.isArray(product?.tags) ? product.tags.join(", ") : "");
  const [status, setStatus] = useState(product?.status ?? "ACTIVE");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [price, setPrice] = useState(product?.variant?.price ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState(product?.variant?.compareAtPrice ?? "");
  const [sku, setSku] = useState(product?.variant?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.variant?.barcode ?? "");
  const [titleStatus, setTitleStatus] = useState("");
  const [mileage, setMileage] = useState("");
  const [sellWhenOutOfStock, setSellWhenOutOfStock] = useState(product?.variant?.inventoryPolicy === "CONTINUE");
  const [cost, setCost] = useState(product?.variant?.cost ?? "");
  const [seoTitle, setSeoTitle] = useState(product?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(product?.seoDescription ?? "");

  useEffect(() => {
    if (!product) return;
    setTitle(product.title ?? "");
    setDescriptionHtml(product.descriptionHtml ?? "");
    setVendor(product.vendor ?? "");
    setProductType(product.productType ?? "Vehicles");
    setTagsString(Array.isArray(product.tags) ? product.tags.join(", ") : "");
    setStatus(product.status ?? "ACTIVE");
    setCategoryId(product.categoryId ?? "");
    setPrice(product.variant?.price ?? "");
    setCompareAtPrice(product.variant?.compareAtPrice ?? "");
    setSku(product.variant?.sku ?? "");
    setBarcode(product.variant?.barcode ?? "");
    setCost(product.variant?.cost ?? "");
    setSeoTitle(product.seoTitle ?? "");
    setSeoDescription(product.seoDescription ?? "");
    const titleMf = product.metafields?.find((m) => m.key === "title_status");
    const mileageMf = product.metafields?.find((m) => m.key === "mileage");
    setTitleStatus(titleMf?.value ?? "");
    setMileage(mileageMf?.value ?? "");
    setSellWhenOutOfStock(product.variant?.inventoryPolicy === "CONTINUE");
  }, [product]);

  const productIdGid = product?.id ?? null;
  const legacyId = params.productId;
  const isBusy = fetcher.state !== "idle";
  const actionError = typeof fetcher.data?.error === "string" ? fetcher.data.error : fetcher.data?.error?.message;
  const saveSuccess = fetcher.data?.ok === true;

  const handleSubmit = (e) => {
    e.preventDefault();
    fetcher.submit(
      {
        intent: "update",
        title,
        descriptionHtml,
        vendor,
        productType,
        tagsString,
        status,
        categoryId,
        price,
        compareAtPrice,
        cost: cost !== "" ? cost : undefined,
        sku,
        barcode,
        titleStatus: titleStatus.trim() || undefined,
        mileage: mileage.trim() !== "" ? mileage.trim() : undefined,
        sellWhenOutOfStock: !!sellWhenOutOfStock,
        seoTitle: seoTitle.trim() || undefined,
        seoDescription: seoDescription.trim() || undefined,
      },
      { method: "POST", encType: "application/json" }
    );
  };

  if (loadError || !product) {
    return (
      <s-page heading="Product">
        <s-stack direction="block" gap="base">
          <s-banner tone="critical">{loadError ?? "Product not found."}</s-banner>
          <Link to={`/admin/products${preserveQs}`} style={{ color: "var(--p-color-text-link, #2c6ecb)" }}>Back to Products</Link>
        </s-stack>
      </s-page>
    );
  }

  return (
    <s-page heading={title || "Edit product"} size="base">
      <s-stack direction="block" gap="base">
        <s-text tone="subdued">
          <Link to={`/admin${preserveQs}`} style={{ color: "var(--p-color-text-link, #2c6ecb)", textDecoration: "none" }}>App</Link>
          <span> › </span>
          <Link to={`/admin/products${preserveQs}`} style={{ color: "var(--p-color-text-link, #2c6ecb)", textDecoration: "none" }}>Products</Link>
          <span> › {title || "Edit"}</span>
        </s-text>

        {saveSuccess && (
          <s-section>
            <s-banner tone="success">Changes saved.</s-banner>
          </s-section>
        )}

        {actionError && (
          <s-banner tone="critical">{actionError}</s-banner>
        )}
      </s-stack>

      <form onSubmit={handleSubmit}>
        <s-section heading="Product details">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Title"
              value={title}
              onInput={(e) => setTitle((e.currentTarget?.value ?? "").slice(0, 255))}
              placeholder="Product title"
            />
            <div>
              <s-text-area
                label="Description"
                value={descriptionHtml}
                onInput={(e) => setDescriptionHtml(e.currentTarget?.value ?? "")}
                placeholder="Describe your product..."
              />
              {descriptionHtml.trim() && (
                <div style={{ marginTop: 12 }}>
                  <s-text type="strong" tone="subdued" style={{ display: "block", marginBottom: 6, fontSize: 12 }}>Preview</s-text>
                  <div
                    className="rte"
                    style={{ padding: 12, border: "1px solid #e1e3e5", borderRadius: 8, background: "#fafbfb", minHeight: 40, fontSize: 14, lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{ __html: descriptionHtml.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "") }}
                  />
                </div>
              )}
            </div>
            <div>
              <s-text type="strong" style={{ display: "block", marginBottom: 8 }}>Media</s-text>
              <MediaPicker
                productId={productIdGid}
                pendingMedia={[]}
                onPendingMediaChange={() => {}}
                disabled={false}
              />
              <s-paragraph tone="subdued" style={{ marginTop: "12px" }}>
                Drag to reorder; use × on a thumbnail to remove. Upload or select existing to add more.
                {productAdminUrl(shop, productIdGid) && (
                  <>{" "}<a href={productAdminUrl(shop, productIdGid)} target="_top" rel="noopener noreferrer" style={{ color: "var(--p-color-text-link, #2c6ecb)", fontWeight: 500 }}>Open in Shopify</a> for more options.</>
                )}
              </s-paragraph>
            </div>
            <s-text-field label="Vendor" value={vendor} onInput={(e) => setVendor(e.currentTarget?.value ?? "")} placeholder="Brand or manufacturer" />
            <s-text-field label="Product type" value={productType} onInput={(e) => setProductType(e.currentTarget?.value ?? "")} placeholder="e.g. Vehicles" />
            <s-text-field label="Tags" value={tagsString} onInput={(e) => setTagsString(e.currentTarget?.value ?? "")} placeholder="Comma-separated tags" helpText="Used for search and filters" />
            <div>
              <label htmlFor="edit-product-category" style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Category</label>
              <select
                id="edit-product-category"
                className="add-product-input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Category"
                style={{ width: "100%", minHeight: "36px", padding: "8px 12px", fontSize: 14, border: "1px solid #c8ccd0", borderRadius: 6 }}
              >
                <option value="">Choose a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName || c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <s-text type="strong" style={{ display: "block", marginBottom: 8 }}>SEO</s-text>
              <s-text-field label="SEO title" value={seoTitle} onInput={(e) => setSeoTitle((e.currentTarget?.value ?? "").slice(0, 70))} placeholder="Search listing title" helpText="Up to 70 characters" />
              <s-text-area label="SEO description" value={seoDescription} onInput={(e) => setSeoDescription((e.currentTarget?.value ?? "").slice(0, 320))} placeholder="Search listing description" style={{ marginTop: 8 }} helpText="Up to 320 characters" />
            </div>
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="Status & pricing">
          <s-stack direction="block" gap="base">
            <div>
              <label htmlFor="edit-product-status" style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Status</label>
              <select id="edit-product-status" className="add-product-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ width: "100%", minHeight: "36px", padding: "8px 12px", fontSize: 14, border: "1px solid #c8ccd0", borderRadius: 6 }}>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <s-text-field label="Price" value={price} onInput={(e) => setPrice(e.currentTarget?.value ?? "")} placeholder="0.00" />
            <s-text-field label="Compare at price" value={compareAtPrice} onInput={(e) => setCompareAtPrice(e.currentTarget?.value ?? "")} placeholder="0.00" />
            <s-text-field label="Cost per item" value={cost} onInput={(e) => setCost(e.currentTarget?.value ?? "")} placeholder="0.00" helpText="Your cost for reporting" />
            <s-text-field label="SKU" value={sku} onInput={(e) => setSku(e.currentTarget?.value ?? "")} placeholder="Optional" />
            <s-text-field label="Barcode" value={barcode} onInput={(e) => setBarcode(e.currentTarget?.value ?? "")} placeholder="Optional" />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                id="edit-product-sell-out"
                checked={!!sellWhenOutOfStock}
                onChange={(e) => setSellWhenOutOfStock(e.target.checked)}
                aria-label="Sell when out of stock"
              />
              <label htmlFor="edit-product-sell-out" style={{ fontWeight: 500, fontSize: 14 }}>Sell when out of stock</label>
            </div>
            <div>
              <s-text type="strong" style={{ display: "block", marginBottom: 8 }}>Vehicle details</s-text>
              <select id="edit-product-title-status" className="add-product-input" value={titleStatus} onChange={(e) => setTitleStatus(e.target.value)} aria-label="Title status" style={{ width: "100%", minHeight: "36px", padding: "8px 12px", fontSize: 14, border: "1px solid #c8ccd0", borderRadius: 6 }}>
                <option value="">Select</option>
                <option value="Clean">Clean</option>
                <option value="Rebuilt">Rebuilt</option>
                <option value="Salvage">Salvage</option>
                <option value="Junk">Junk</option>
                <option value="Flood">Flood</option>
              </select>
              <s-number-field label="Miles" value={mileage} onInput={(e) => setMileage(e.currentTarget?.value ?? "")} placeholder="e.g. 45000" min={0} style={{ marginTop: 12 }} />
            </div>
            <div className="add-product-save-bar" style={{ marginTop: 8 }}>
              <s-button type="submit" variant="primary" disabled={!title.trim() || isBusy} {...(isBusy ? { loading: true } : {})}>
                {isBusy ? "Saving…" : "Save"}
              </s-button>
              {productAdminUrl(shop, productIdGid) && (
                <a href={productAdminUrl(shop, productIdGid)} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "12px", color: "var(--p-color-text-link, #2c6ecb)", fontSize: "14px" }}>
                  Open in Shopify
                </a>
              )}
            </div>
          </s-stack>
        </s-section>
      </form>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
