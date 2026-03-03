import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useLocation } from "react-router";
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
  titleStatus: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional(),
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
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
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
    titleStatus,
    mileage,
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

  // Cap description so outbound Shopify GraphQL payload stays under limits (avoids "syntax error, unexpected end of file")
  const MAX_DESCRIPTION_CHARS = 100_000;
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
      titleStatus: titleStatus?.trim() || undefined,
      mileage: mileage != null && mileage !== "" ? mileage : undefined,
      media: mediaForCreate.length ? mediaForCreate : undefined,
    });
    return Response.json({
      product: result.product,
      productId: result.productId,
      ...(result.warnings?.length && { warnings: result.warnings }),
    });
  } catch (err) {
    const msg = err?.message ?? "";
    const code = err?.code ?? "?";
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      event: "ADMIN_ADD_PRODUCT_ERROR",
      shop: session?.shop ?? null,
      errCode: code,
      errMessage: msg.slice(0, 200),
      hint: "See [shopify-graphql] RESPONSE_GRAPHQL_ERR / responseBodyPreview in logs above for root cause",
    }));
    logServerError("admin.add-product.action", err, { shop: session?.shop, errCode: code });
    let userMessage = msg || "Could not create product.";
    if (/syntax error|unexpected end of file|unexpected end of json|failed to parse graphql response/i.test(msg)) {
      userMessage =
        "Save failed: Shopify returned a GraphQL error. Check Vercel logs for \"RESPONSE_GRAPHQL_ERR\" and \"responseBodyPreview\" to diagnose. If you see \"Can't reach database\", fix DATABASE_URL.";
    }
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
  const location = useLocation();
  const fetcher = useFetcher();
  const decodeFetcher = useFetcher();
  const [vin, setVin] = useState("");
  const [decoded, setDecoded] = useState(null);
  const [title, setTitle] = useState("");
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("Vehicles");
  const [tagsString, setTagsString] = useState("");
  const [titleStatus, setTitleStatus] = useState("");
  const [mileage, setMileage] = useState("");
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
        ...(titleStatus.trim() && { titleStatus: titleStatus.trim() }),
        ...(mileage.trim() !== "" && { mileage: mileage.trim() }),
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
    setTitleStatus("");
    setMileage("");
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
    <s-page heading="Add product" size="base">
      <s-stack direction="block" gap="base">
        <s-text tone="subdued">
          <Link to={`/admin${location?.search ?? ""}`} style={{ color: "var(--p-color-text-link, #2c6ecb)", textDecoration: "none" }}>App</Link>
          <span> › Add product</span>
        </s-text>

        {productId && (
          <s-section>
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
            <s-stack direction="inline" gap="base" style={{ marginTop: "12px", flexWrap: "wrap" }}>
              {productAdminUrl(shop, productId) && (
                <a href={productAdminUrl(shop, productId)} target="_top" rel="noopener noreferrer" style={{ color: "var(--p-color-text-link, #2c6ecb)", fontWeight: 600, fontSize: "14px" }}>
                  Open product in Shopify
                </a>
              )}
              <s-button type="button" variant="primary" onClick={handleAddAnother}>
                Add another product
              </s-button>
            </s-stack>
          </s-section>
        )}

        <form onSubmit={handleSubmit}>
          <s-stack direction="block" gap="base" style={{ maxWidth: "720px" }}>
            <s-section heading="Title">
              <s-text-field
                label="Title"
                value={title}
                onInput={(e) => setTitle((e.currentTarget?.value ?? "").slice(0, 255))}
                placeholder="Short sleeve t-shirt"
              />
            </s-section>

            <s-section heading="Description">
              <s-text-area
                label="Description"
                value={descriptionHtml}
                onInput={(e) => setDescriptionHtml(e.currentTarget?.value ?? "")}
                placeholder="Describe your product..."
              />
            </s-section>

            <s-section heading="Media">
              <MediaPicker
                productId={productId}
                pendingMedia={pendingMedia}
                onPendingMediaChange={setPendingMedia}
                disabled={false}
              />
              {productAdminUrl(shop, productId) && (
                <s-paragraph tone="subdued" style={{ marginTop: "12px" }}>
                  <a href={productAdminUrl(shop, productId)} target="_top" rel="noopener noreferrer" style={{ color: "var(--p-color-text-link, #2c6ecb)", fontWeight: 500 }}>Open product in Shopify</a>
                  {" "}to manage media there too.
                </s-paragraph>
              )}
            </s-section>

            <s-section heading="Category">
              <select
                id="add-product-category"
                className="add-product-input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Product category"
                style={{ width: "100%", minHeight: "36px", padding: "8px 12px", fontSize: 14, border: "1px solid #c8ccd0", borderRadius: 6 }}
              >
                <option value="">Choose a product category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName || c.name}</option>
                ))}
              </select>
              <s-paragraph tone="subdued" style={{ marginTop: 6 }}>Determines tax rates and adds metafields to improve search, filters, and cross-channel sales</s-paragraph>
            </s-section>

            <s-section heading="VIN decoder">
              <s-paragraph tone="subdued" style={{ marginBottom: 8 }}>Enter a VIN and click Decode to auto-fill title, description, vendor, and tags.</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-text-field
                  label="VIN"
                  value={vin}
                  onInput={(e) => setVin((e.currentTarget?.value ?? "").toUpperCase().slice(0, VIN_LENGTH))}
                  placeholder="e.g. 1HGBH41JXMN109186"
                  maxLength={VIN_LENGTH}
                  helpText={`${vin.length}/${VIN_LENGTH} characters`}
                />
                <s-button type="button" variant="secondary" disabled={vin.trim().length < 8 || decodeBusy} onClick={handleDecode} {...(decodeBusy ? { loading: true } : {})}>
                  Decode VIN
                </s-button>
              </s-stack>
              {decodeError && <s-banner tone="critical" style={{ marginTop: 8 }}>{decodeError}</s-banner>}
            </s-section>

            <s-section heading="Status">
              <select
                id="add-product-status"
                className="add-product-input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status"
                style={{ width: "100%", minHeight: "36px", padding: "8px 12px", fontSize: 14, border: "1px solid #c8ccd0", borderRadius: 6 }}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </s-section>

            <s-section heading="Pricing">
              <s-text-field label="Price" value={price} onInput={(e) => setPrice(e.currentTarget?.value ?? "")} placeholder="0.00" />
              <s-stack direction="block" gap="base" style={{ marginTop: 12 }}>
                <s-text-field label="Compare at price" value={compareAtPrice} onInput={(e) => setCompareAtPrice(e.currentTarget?.value ?? "")} placeholder="0.00" />
                <s-text-field label="Cost per item" value={cost} onInput={(e) => setCost(e.currentTarget?.value ?? "")} placeholder="0.00" />
              </s-stack>
            </s-section>

            <s-section heading="Vehicle details">
              <select
                id="add-product-title-status"
                className="add-product-input"
                value={titleStatus}
                onChange={(e) => setTitleStatus(e.target.value)}
                aria-label="Title status"
                style={{ width: "100%", minHeight: "36px", padding: "8px 12px", fontSize: 14, border: "1px solid #c8ccd0", borderRadius: 6 }}
              >
                <option value="">Select title status</option>
                <option value="Clean">Clean</option>
                <option value="Rebuilt">Rebuilt</option>
                <option value="Salvage">Salvage</option>
                <option value="Junk">Junk</option>
                <option value="Flood">Flood</option>
              </select>
              <s-paragraph tone="subdued" style={{ marginTop: 6 }}>Saved to product metafield (Brand) for filters.</s-paragraph>
              <s-number-field
                label="Miles"
                value={mileage}
                onInput={(e) => setMileage(e.currentTarget?.value ?? "")}
                placeholder="e.g. 45000"
                min={0}
                style={{ marginTop: 12 }}
              />
              <s-paragraph tone="subdued" style={{ marginTop: 6 }}>Odometer reading. Saved to product metafield for filters.</s-paragraph>
            </s-section>

            <div className="add-product-save-bar" style={{ marginTop: 24 }}>
              <s-button type="submit" variant="primary" disabled={!title.trim() || isBusy} {...(isBusy ? { loading: true } : {})}>
                {isBusy ? "Working…" : "Save product"}
              </s-button>
            </div>
          </s-stack>
        </form>

        {error && (
          <s-banner tone="critical" style={{ marginTop: "1rem" }}>
            {error}
          </s-banner>
        )}
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
