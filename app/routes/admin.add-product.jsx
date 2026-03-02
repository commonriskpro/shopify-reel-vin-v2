import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { logServerError } from "../http.server.js";
import { getCategoriesForVehicles } from "../services/categories.server.js";
import { createProductFull } from "../services/products.server.js";
import { decodeVin, vehicleTitleFromDecoded, vehicleDescriptionFromDecoded, tagsFromDecoded } from "../services/vins.server.js";
import { enforceRateLimit, isValidVin, normalizeVin } from "../security.server.js";
import { MediaPicker } from "../components/MediaPicker.jsx";
import { getWarnings } from "../lib/api-client.js";
import "../styles/admin.add-product.css";

const VIN_LENGTH = 17;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let categories = [];
  let defaultCategoryId = "";
  try {
    const { categories: catList, defaultCategoryId: defaultId } = await getCategoriesForVehicles(admin);
    categories = catList;
    defaultCategoryId = defaultId;
  } catch (err) {
    logServerError("admin.add-product.loader", err, { requestId: "[loader]" });
  }
  return { shop: session?.shop ?? "", categories, defaultCategoryId };
};

const actionBodySchema = z.object({
  decodeOnly: z.boolean().optional(),
  vin: z.string().optional(),
  title: z.string().optional(),
  descriptionHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tagsString: z.string().optional(),
  status: z.string().optional(),
  categoryId: z.string().optional(),
  templateSuffix: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  compareAtPrice: z.union([z.string(), z.number()]).optional(),
  cost: z.union([z.string(), z.number()]).optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  sellWhenOutOfStock: z.boolean().optional(),
  media: z.array(z.object({
    originalSource: z.string(),
    mediaContentType: z.string().optional(),
    alt: z.string().optional(),
  })).optional(),
  decoded: z.record(z.unknown()).optional(),
}).passthrough();

export const action = async ({ request }) => {
  if (request.method !== "POST") return null;
  // authenticate.admin() throws a Response redirect when the session is missing
  // or expired. Re-throwing it lets React Router handle the redirect properly
  // rather than collapsing it into a 500 on .data fetch requests.
  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  // Reject oversized bodies so the request is not truncated (avoids Shopify "syntax error, unexpected end of file")
  const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
  const contentLength = request.headers.get("content-length");
  if (contentLength != null) {
    const len = parseInt(contentLength, 10);
    if (!Number.isNaN(len) && len > MAX_BODY_BYTES) {
      return Response.json(
        { error: "Request too large. Shorten the description or remove extra media and try again." },
        { status: 413 }
      );
    }
  }
  let rawBody;
  try {
    rawBody = await request.json();
  } catch (e) {
    const msg = e?.message ?? "";
    const truncated = /unexpected end of json input|syntax error|unexpected end of file/i.test(msg);
    return Response.json(
      { error: truncated ? "Request body was truncated or invalid. Try shortening the description and save again." : "Invalid request body." },
      { status: 400 }
    );
  }
  const bodyParse = actionBodySchema.safeParse(rawBody);
  if (!bodyParse.success) {
    return Response.json({ error: "Validation failed", details: bodyParse.error.flatten() }, { status: 400 });
  }
  const body = bodyParse.data;

  if (body.decodeOnly && body.vin) {
    const normalizedVin = normalizeVin(body.vin);
    if (!normalizedVin || !isValidVin(normalizedVin)) {
      return Response.json({ error: "Please provide a valid VIN (8–17 characters)." }, { status: 400 });
    }
    const limited = enforceRateLimit(request, {
      scope: "admin.add-product.decode",
      limit: 20,
      windowMs: 60_000,
      keyParts: [session?.shop || "unknown"],
    });
    if (!limited.ok) {
      return Response.json(
        { error: "Too many requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
      );
    }
    try {
      const { decoded } = await decodeVin(normalizedVin);
      const title = vehicleTitleFromDecoded(decoded) || [decoded?.year, decoded?.make, decoded?.model].filter(Boolean).join(" ") || "Vehicle";
      const descriptionHtml = vehicleDescriptionFromDecoded(decoded, normalizedVin);
      const tags = tagsFromDecoded(decoded);
      const vendor = decoded?.manufacturer || "";
      return Response.json({ decoded, title, descriptionHtml, tags, vendor });
    } catch (err) {
      logServerError("admin.add-product.decode", err, { shop: session?.shop });
      return Response.json({ error: "Failed to decode VIN." }, { status: 502 });
    }
  }

  const {
    title,
    descriptionHtml,
    vendor,
    productType,
    tagsString,
    status,
    categoryId,
    templateSuffix,
    seoTitle,
    seoDescription,
    price,
    compareAtPrice,
    cost,
    sku,
    barcode,
    sellWhenOutOfStock,
    vin,
    decoded,
    media: submitMedia,
  } = body || {};

  if (!title || !String(title).trim()) {
    return Response.json({ error: "Title is required." }, { status: 400 });
  }

  const tags = typeof tagsString === "string"
    ? tagsString.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const mediaForCreate = Array.isArray(submitMedia)
    ? submitMedia.filter((m) => m && m.originalSource && m.mediaContentType)
    : [];

  // Cap description size to avoid oversized GraphQL variables and "syntax error, unexpected end of file"
  const MAX_DESCRIPTION_CHARS = 500_000;
  const safeDescription =
    descriptionHtml != null
      ? String(descriptionHtml).slice(0, MAX_DESCRIPTION_CHARS)
      : undefined;

  try {
    const result = await createProductFull(admin, {
      title: String(title).trim(),
      descriptionHtml: safeDescription,
      vendor: vendor?.trim(),
      productType: productType?.trim() || "Vehicles",
      tags: tags.length ? tags : undefined,
      status: status === "DRAFT" ? "DRAFT" : status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
      categoryId: categoryId?.trim(),
      templateSuffix: templateSuffix?.trim(),
      seoTitle: seoTitle?.trim(),
      seoDescription: seoDescription?.trim(),
      price: price != null ? String(price) : undefined,
      compareAtPrice: compareAtPrice != null ? String(compareAtPrice) : undefined,
      cost: cost != null ? String(cost) : undefined,
      sku: sku?.trim(),
      barcode: barcode?.trim(),
      trackInventory: true,
      sellWhenOutOfStock: sellWhenOutOfStock === true,
      vin: vin?.trim() || undefined,
      decoded: decoded || undefined,
      media: mediaForCreate.length ? mediaForCreate : undefined,
    });
    return Response.json({
      product: result.product,
      productId: result.productId,
      ...(result.warnings?.length && { warnings: result.warnings }),
    });
  } catch (err) {
    logServerError("admin.add-product.action", err, { shop: session?.shop });
    const msg = err?.message ?? "";
    const userMessage =
      /syntax error|unexpected end of file|unexpected end of json/i.test(msg)
        ? "Product data may be too large or was truncated. Try shortening the description and save again."
        : (msg || "Could not create product.");
    return Response.json(
      { error: userMessage },
      { status: 502 }
    );
  }
};

function productAdminUrl(shop, productIdGid) {
  if (!shop || !productIdGid) return null;
  const numericId = productIdGid.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!numericId) return null;
  return `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${numericId}`;
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function AddProduct() {
  const { shop, categories, defaultCategoryId } = useLoaderData() ?? {};
  const fetcher = useFetcher();
  const decodeFetcher = useFetcher();
  const [vin, setVin] = useState("");
  const [decoded, setDecoded] = useState(null);
  const [title, setTitle] = useState("");
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("Vehicles");
  const [tagsString, setTagsString] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [categoryId, setCategoryId] = useState(() => defaultCategoryId ?? "");
  const [templateSuffix, setTemplateSuffix] = useState("default-product");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [cost, setCost] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [sellWhenOutOfStock, setSellWhenOutOfStock] = useState(false);
  const [chargeTax, setChargeTax] = useState(true);
  const [publishingChannel, setPublishingChannel] = useState("online_store");
  const [pendingMedia, setPendingMedia] = useState([]);

  const isBusy = fetcher.state !== "idle";
  const decodeBusy = decodeFetcher.state !== "idle";
  const productId = fetcher.data?.productId ?? fetcher.data?.product?.id;
  const actionError = typeof fetcher.data?.error === "string" ? fetcher.data.error : fetcher.data?.error?.message;
  const decodeError = typeof decodeFetcher.data?.error === "string" ? decodeFetcher.data.error : decodeFetcher.data?.error?.message;
  const warnings = getWarnings(fetcher.data);
  const error = actionError || decodeError;

  useEffect(() => {
    if (defaultCategoryId) {
      setCategoryId((prev) => (prev === "" ? defaultCategoryId : prev));
    }
  }, [defaultCategoryId]);

  useEffect(() => {
    if (productId) {
      setPendingMedia([]);
    }
  }, [productId]);

  useEffect(() => {
    if (decodeFetcher.state !== "idle" || !decodeFetcher.data?.decoded) return;
    const d = decodeFetcher.data;
    setTitle(d.title || "");
    setDescriptionHtml(d.descriptionHtml || "");
    setTagsString(Array.isArray(d.tags) ? d.tags.join(", ") : "");
    setVendor(d.vendor || "");
    setProductType("Vehicles");
    setDecoded(d.decoded);
  }, [decodeFetcher.state, decodeFetcher.data]);

  const handleDecode = (e) => {
    e?.preventDefault();
    const v = vin.trim().toUpperCase();
    if (v.length < 8) return;
    decodeFetcher.submit(
      { vin: v, decodeOnly: true },
      { method: "POST", encType: "application/json" }
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    fetcher.submit(
      {
        title,
        descriptionHtml,
        vendor,
        productType,
        tagsString,
        status,
        categoryId,
        templateSuffix,
        seoTitle,
        seoDescription,
        price,
        compareAtPrice,
        cost,
        sku,
        barcode,
        trackInventory: true,
        sellWhenOutOfStock,
        ...(vin.trim() && { vin: vin.trim().toUpperCase() }),
        ...(decoded && { decoded }),
        media: pendingMedia.map((m) => ({
          originalSource: m.originalSource,
          mediaContentType: m.mediaContentType || "IMAGE",
          alt: m.alt,
        })),
      },
      { method: "POST", encType: "application/json" }
    );
  };

  const handleAddAnother = () => {
    setTitle("");
    setDescriptionHtml("");
    setVendor("");
    setProductType("Vehicles");
    setTagsString("");
    setStatus("ACTIVE");
    setCategoryId(defaultCategoryId ?? "");
    setSeoTitle("");
    setSeoDescription("");
    setPrice("");
    setCompareAtPrice("");
    setCost("");
    setSku("");
    setBarcode("");
    setVin("");
    setDecoded(null);
    setPendingMedia([]);
  };

  return (
    <s-page heading="Add product">
      <div className="add-product-page">
        <div className="add-product-breadcrumb">
          <Link to="/admin">VIN Decoder</Link>
          <span> › Add product</span>
        </div>

        {productId && (
          <div className="add-product-success-bar">
            <s-banner tone="success">
              Product created successfully.
            </s-banner>
            {warnings.length > 0 && (
              <s-banner tone="warning" style={{ marginTop: "8px" }}>
                Completed with warnings:
                <ul style={{ margin: "0.25rem 0 0 1rem", paddingLeft: "0.5rem" }}>
                  {warnings.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </s-banner>
            )}
            <div style={{ display: "flex", gap: "12px", marginTop: "12px", flexWrap: "wrap" }}>
              {productAdminUrl(shop, productId) && (
                <a
                  href={productAdminUrl(shop, productId)}
                  target="_top"
                  rel="noopener noreferrer"
                  style={{ color: "#2c6ecb", fontWeight: 600, fontSize: "14px" }}
                >
                  Open product in Shopify
                </a>
              )}
              <s-button type="button" variant="primary" onClick={handleAddAnother}>
                Add another product
              </s-button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="add-product-grid">
            {/* Left column – main content */}
            <div>
              <div className="add-product-card">
                <label className="add-product-label" htmlFor="add-product-title">Title</label>
                <input
                  id="add-product-title"
                  type="text"
                  className="add-product-input"
                  value={title}
                  onChange={(e) => setTitle((e.target?.value ?? "").slice(0, 255))}
                  placeholder="Short sleeve t-shirt"
                />
              </div>

              <div className="add-product-card">
                <label className="add-product-label">Description</label>
                <div className="add-product-toolbar">
                  <select className="add-product-toolbar-select" aria-label="Format">
                    <option>Paragraph</option>
                  </select>
                  <button type="button" className="add-product-toolbar-btn" title="Bold" aria-label="Bold">B</button>
                  <button type="button" className="add-product-toolbar-btn" title="Italic" aria-label="Italic"><em>I</em></button>
                  <button type="button" className="add-product-toolbar-btn" title="Underline" aria-label="Underline">U</button>
                  <button type="button" className="add-product-toolbar-btn" title="Text color" aria-label="Color">A</button>
                  <button type="button" className="add-product-toolbar-btn" title="Link" aria-label="Link">⎋</button>
                  <button type="button" className="add-product-toolbar-btn" title="Image" aria-label="Image">🖼</button>
                  <button type="button" className="add-product-toolbar-btn" title="More" aria-label="More">⋯</button>
                  <button type="button" className="add-product-toolbar-btn" title="Code" aria-label="Code">&lt;/&gt;</button>
                </div>
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
                  productId={productId}
                  pendingMedia={pendingMedia}
                  onPendingMediaChange={setPendingMedia}
                  disabled={false}
                />
                {productAdminUrl(shop, productId) && (
                  <p className="add-product-hint" style={{ marginTop: "12px" }}>
                    <a
                      href={productAdminUrl(shop, productId)}
                      target="_top"
                      rel="noopener noreferrer"
                      style={{ color: "#2c6ecb", fontWeight: 500 }}
                    >
                      Open product in Shopify
                    </a>
                    {" "}to manage media there too.
                  </p>
                )}
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="add-product-category">Category</label>
                <select
                  id="add-product-category"
                  className="add-product-input"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">Choose a product category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName || c.name}</option>
                  ))}
                </select>
                <p className="add-product-hint">Determines tax rates and adds metafields to improve search, filters, and cross-channel sales</p>
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="add-product-price">Price</label>
                <input
                  id="add-product-price"
                  type="text"
                  className="add-product-input"
                  value={price}
                  onChange={(e) => setPrice(e.target?.value ?? "")}
                  placeholder="0.00"
                />
                <div className="add-product-options-row">
                  <button type="button" className="add-product-option-item">Compare at ▾</button>
                  <button type="button" className="add-product-option-item">Unit price ▾</button>
                  <button type="button" className="add-product-option-item">Charge tax {chargeTax ? "Yes" : "No"} ▾</button>
                  <button type="button" className="add-product-option-item">Cost per item ▾</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
                  <div>
                    <label className="add-product-label" htmlFor="add-product-compare" style={{ fontSize: "13px" }}>Compare at price</label>
                    <input id="add-product-compare" type="text" className="add-product-input" value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target?.value ?? "")} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="add-product-label" htmlFor="add-product-cost" style={{ fontSize: "13px" }}>Cost per item</label>
                    <input id="add-product-cost" type="text" className="add-product-input" value={cost} onChange={(e) => setCost(e.target?.value ?? "")} placeholder="0.00" />
                  </div>
                </div>
              </div>
            </div>

            {/* Right column – sidebar */}
            <div>
              <div className="add-product-card">
                <label className="add-product-label" htmlFor="add-product-vin">VIN decoder</label>
                <p className="add-product-hint" style={{ marginBottom: "8px" }}>
                  Enter a VIN and click Decode to auto-fill title, description, vendor, and tags.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <input
                    id="add-product-vin"
                    type="text"
                    className="add-product-input"
                    value={vin}
                    onChange={(e) => setVin((e.target?.value ?? "").toUpperCase().slice(0, VIN_LENGTH))}
                    placeholder="e.g. 1HGBH41JXMN109186"
                    maxLength={VIN_LENGTH}
                    style={{ flex: "1", minWidth: "140px" }}
                  />
                  <s-button
                    type="button"
                    variant="secondary"
                    disabled={vin.trim().length < 8 || decodeBusy}
                    onClick={handleDecode}
                    {...(decodeBusy ? { loading: true } : {})}
                  >
                    Decode VIN
                  </s-button>
                </div>
                <p className="add-product-hint" style={{ marginTop: "6px" }}>{vin.length}/{VIN_LENGTH} characters</p>
                {decodeError && (
                  <s-banner tone="critical" style={{ marginTop: "8px" }}>{decodeError}</s-banner>
                )}
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="add-product-status">Status</label>
                <select
                  id="add-product-status"
                  className="add-product-input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="add-product-card">
                <div className="add-product-card-heading">
                  <label className="add-product-label">Publishing</label>
                  <span className="add-product-card-heading-icon" role="img" aria-label="Settings">⚙</span>
                </div>
                <div className="add-product-tabs">
                  <button
                    type="button"
                    className={`add-product-tab ${publishingChannel === "online_store" ? "active" : ""}`}
                    onClick={() => setPublishingChannel("online_store")}
                  >
                    Online Store
                  </button>
                  <button
                    type="button"
                    className={`add-product-tab ${publishingChannel === "shop" ? "active" : ""}`}
                    onClick={() => setPublishingChannel("shop")}
                  >
                    Shop
                  </button>
                  <button
                    type="button"
                    className={`add-product-tab ${publishingChannel === "pos" ? "active" : ""}`}
                    onClick={() => setPublishingChannel("pos")}
                  >
                    Point of Sale
                  </button>
                </div>
              </div>

              <div className="add-product-card">
                <div className="add-product-card-heading">
                  <label className="add-product-label">Product organization</label>
                  <span className="add-product-card-heading-icon" role="img" aria-label="Info">ℹ</span>
                </div>
                <input
                  type="text"
                  className="add-product-input"
                  style={{ marginBottom: "12px" }}
                  placeholder="Type"
                  value={productType}
                  onChange={(e) => setProductType(e.target?.value ?? "")}
                />
                <input
                  type="text"
                  className="add-product-input"
                  style={{ marginBottom: "12px" }}
                  placeholder="Vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target?.value ?? "")}
                />
                <input
                  type="text"
                  className="add-product-input"
                  style={{ marginBottom: "12px" }}
                  placeholder="Collections"
                />
                <input
                  type="text"
                  className="add-product-input"
                  placeholder="Tags"
                  value={tagsString}
                  onChange={(e) => setTagsString(e.target?.value ?? "")}
                />
              </div>

              <div className="add-product-card">
                <label className="add-product-label" htmlFor="add-product-template">Theme template</label>
                <select
                  id="add-product-template"
                  className="add-product-input"
                  value={templateSuffix}
                  onChange={(e) => setTemplateSuffix(e.target.value)}
                >
                  <option value="default-product">Default product</option>
                  <option value="">(none)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="add-product-save-bar">
            <s-button
              type="submit"
              variant="primary"
              disabled={!title.trim() || isBusy}
              {...(isBusy ? { loading: true } : {})}
            >
              {isBusy ? "Working…" : "Save product"}
            </s-button>
          </div>
        </form>

        {error && (
          <s-banner tone="critical" style={{ marginTop: "1rem" }}>
            {error}
          </s-banner>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
