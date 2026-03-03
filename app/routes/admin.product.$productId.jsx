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
  sku: z.string().optional(),
  barcode: z.string().optional(),
  titleStatus: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional(),
  sellWhenOutOfStock: z.boolean().optional(),
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
      sku: data.sku,
      barcode: data.barcode,
      titleStatus: data.titleStatus,
      mileage: data.mileage,
      sellWhenOutOfStock: data.sellWhenOutOfStock,
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
        sku,
        barcode,
        titleStatus: titleStatus.trim() || undefined,
        mileage: mileage.trim() !== "" ? mileage.trim() : undefined,
        sellWhenOutOfStock: !!sellWhenOutOfStock,
      },
      { method: "POST", encType: "application/json" }
    );
  };

  if (loadError || !product) {
    return (
      <s-page heading="Product">
        <div className="add-product-page">
          <s-banner tone="critical">{loadError ?? "Product not found."}</s-banner>
          <p style={{ marginTop: "16px" }}>
            <Link to={`/admin/products${preserveQs}`} style={{ color: "#2c6ecb" }}>Back to Products</Link>
          </p>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading={title || "Edit product"}>
      <div className="add-product-page">
        <div className="add-product-breadcrumb">
          <Link to={`/admin${preserveQs}`}>App</Link>
          <span> › </span>
          <Link to={`/admin/products${preserveQs}`}>Products</Link>
          <span> › {title || "Edit"}</span>
        </div>

        {saveSuccess && (
          <div className="add-product-success-bar">
            <s-banner tone="success">Changes saved.</s-banner>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="add-product-grid">
            <div>
              <div className="add-product-card">
                <label className="add-product-label" htmlFor="edit-product-title">Title</label>
                <input
                  id="edit-product-title"
                  type="text"
                  className="add-product-input"
                  value={title}
                  onChange={(e) => setTitle((e.target?.value ?? "").slice(0, 255))}
                  placeholder="Product title"
                />
              </div>

              <div className="add-product-card">
                <label className="add-product-label">Description</label>
                <textarea
                  className="add-product-input add-product-textarea"
                  value={descriptionHtml}
                  onChange={(e) => setDescriptionHtml(e.target?.value ?? "")}
                  placeholder="Describe your product..."
                />
              </div>

              <div className="add-product-card">
                <label className="add-product-label">Media</label>
                <MediaPicker
                  productId={productIdGid}
                  pendingMedia={[]}
                  onPendingMediaChange={() => {}}
                  disabled={false}
                />
                {productAdminUrl(shop, productIdGid) && (
                  <p className="add-product-hint" style={{ marginTop: "12px" }}>
                    <a href={productAdminUrl(shop, productIdGid)} target="_top" rel="noopener noreferrer" style={{ color: "#2c6ecb", fontWeight: 500 }}>
                      Open in Shopify
                    </a>
                    {" "}to reorder or replace media.
                  </p>
                )}
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="edit-product-category">Category</label>
                <select
                  id="edit-product-category"
                  className="add-product-input"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">Choose a category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName || c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="add-product-card">
                <label className="add-product-label" htmlFor="edit-product-status">Status</label>
                <select id="edit-product-status" className="add-product-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="edit-product-price">Price</label>
                <input
                  id="edit-product-price"
                  type="text"
                  className="add-product-input"
                  value={price}
                  onChange={(e) => setPrice(e.target?.value ?? "")}
                  placeholder="0.00"
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
                  <div>
                    <label className="add-product-label" style={{ fontSize: "13px" }}>Compare at price</label>
                    <input type="text" className="add-product-input" value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target?.value ?? "")} placeholder="0.00" />
                  </div>
                </div>
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="edit-product-title-status">Title status</label>
                <select id="edit-product-title-status" className="add-product-input" value={titleStatus} onChange={(e) => setTitleStatus(e.target.value)}>
                  <option value="">Select</option>
                  <option value="Clean">Clean</option>
                  <option value="Rebuilt">Rebuilt</option>
                  <option value="Salvage">Salvage</option>
                  <option value="Junk">Junk</option>
                  <option value="Flood">Flood</option>
                </select>
                <label className="add-product-label" htmlFor="edit-product-mileage" style={{ marginTop: "12px", display: "block" }}>Miles</label>
                <input
                  id="edit-product-mileage"
                  type="number"
                  min="0"
                  className="add-product-input"
                  placeholder="e.g. 45000"
                  value={mileage}
                  onChange={(e) => setMileage(e.target?.value ?? "")}
                />
              </div>
            </div>
          </div>

          <div className="add-product-save-bar">
            <s-button type="submit" variant="primary" disabled={!title.trim() || isBusy} {...(isBusy ? { loading: true } : {})}>
              {isBusy ? "Saving…" : "Save"}
            </s-button>
            {productAdminUrl(shop, productIdGid) && (
              <a
                href={productAdminUrl(shop, productIdGid)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: "12px", color: "#2c6ecb", fontSize: "14px" }}
              >
                Open in Shopify
              </a>
            )}
          </div>
        </form>

        {actionError && (
          <s-banner tone="critical" style={{ marginTop: "1rem" }}>
            {actionError}
          </s-banner>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
