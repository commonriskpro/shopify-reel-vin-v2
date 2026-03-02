import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { logServerError } from "../http.server.js";
import { decodeVin, vehicleTitleFromDecoded } from "../services/vins.server.js";
import { createProductFromVin } from "../services/products.server.js";
import { enforceRateLimit, isValidVin, normalizeVin } from "../security.server.js";
import { getWarnings } from "../lib/api-client.js";

const VIN_LENGTH = 17;
const TITLE_OPTIONS = ["", "Clean", "Salvage", "Rebuilt", "Junk"];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session?.shop ?? "" };
};

const actionBodySchema = z.object({
  vin: z.string().optional(),
  decodeOnly: z.boolean().optional(),
  decodeAndCreateDraft: z.boolean().optional(),
  titleStatus: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional(),
}).passthrough();

export const action = async ({ request }) => {
  if (request.method !== "POST") return null;
  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const bodyParse = actionBodySchema.safeParse(rawBody);
  if (!bodyParse.success) {
    return Response.json({ error: "Validation failed" }, { status: 400 });
  }
  const { vin, decodeOnly, decodeAndCreateDraft, titleStatus, mileage } = bodyParse.data;
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin || !isValidVin(normalizedVin)) {
    return Response.json({ error: "Please provide a valid VIN (8-17 characters)." }, { status: 400 });
  }

  if (decodeOnly) {
    const limited = enforceRateLimit(request, {
      scope: "admin.add-vehicle.decode",
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
      return Response.json({ decoded });
    } catch (err) {
      logServerError("admin.add-vehicle.decode", err, { shop: session?.shop });
      return Response.json({ error: "Failed to decode VIN." }, { status: 502 });
    }
  }

  if (decodeAndCreateDraft) {
    const limited = enforceRateLimit(request, {
      scope: "admin.create-draft",
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
    const decodeLimited = enforceRateLimit(request, {
      scope: "admin.decode-and-create",
      limit: 10,
      windowMs: 60_000,
      keyParts: [session?.shop || "unknown"],
    });
    if (!decodeLimited.ok) {
      return Response.json(
        { error: "Too many decode requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(decodeLimited.retryAfterSeconds) } }
      );
    }
    let decoded;
    try {
      const result = await decodeVin(normalizedVin);
      decoded = result.decoded;
    } catch (err) {
      logServerError("admin.add-vehicle.decode", err, { shop: session?.shop });
      return Response.json({ error: "Failed to decode VIN." }, { status: 502 });
    }
    const title = vehicleTitleFromDecoded(decoded) || [decoded?.year, decoded?.make, decoded?.model].filter(Boolean).join(" ") || "Vehicle";
    try {
      const result = await createProductFromVin(admin, {
        vin: decoded.vin || normalizedVin,
        title,
        decoded,
        titleStatus: titleStatus ?? undefined,
        mileage: mileage ?? undefined,
      });
      const inventoryError = result.warnings?.find((w) => w.code === "INVENTORY_NOT_SET")?.message;
      return Response.json({
        decoded,
        product: result.product,
        ...(inventoryError && { inventoryError }),
      });
    } catch (err) {
      logServerError("admin.add-vehicle.createProduct", err, { shop: session?.shop });
      return Response.json(
        { error: err?.message || "Could not create product." },
        { status: 502 }
      );
    }
  }

  return Response.json({ error: "Missing decodeOnly or decodeAndCreateDraft" }, { status: 400 });
};

function productAdminUrl(shop, productIdGid) {
  if (!shop || !productIdGid) return null;
  const numericId = productIdGid.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!numericId) return null;
  return `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${numericId}`;
}

export default function AddVehicle() {
  const { shop } = useLoaderData() ?? {};
  const fetcher = useFetcher();
  const [vin, setVin] = useState("");
  const [decoded, setDecoded] = useState(null);
  const [productId, setProductId] = useState(null);
  const [titleStatus, setTitleStatus] = useState("");
  const [mileage, setMileage] = useState("");

  const isBusy = fetcher.state !== "idle";
  const actionError = typeof fetcher.data?.error === "string" ? fetcher.data.error : fetcher.data?.error?.message;
  const actionWarnings = getWarnings(fetcher.data);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) return;
    if (fetcher.data.product?.id) {
      setProductId(fetcher.data.product.id);
      return;
    }
    if (fetcher.data.decoded) {
      setDecoded(fetcher.data.decoded);
    }
  }, [fetcher.state, fetcher.data]);

  const handleDecode = (e) => {
    e?.preventDefault();
    const v = vin.trim().toUpperCase();
    if (v.length < 8) return;
    fetcher.submit(
      { vin: v, decodeOnly: true },
      { method: "POST", encType: "application/json" }
    );
  };

  const handleAddToStore = (e) => {
    e?.preventDefault();
    const v = vin.trim().toUpperCase();
    if (v.length < 8) return;
    fetcher.submit(
      {
        vin: v,
        decodeAndCreateDraft: true,
        ...(titleStatus && { titleStatus: titleStatus.trim() }),
        ...(mileage !== "" && { mileage: mileage.trim() }),
      },
      { method: "POST", encType: "application/json" }
    );
  };

  const handleAddAnother = () => {
    setVin("");
    setDecoded(null);
    setProductId(null);
    setTitleStatus("");
    setMileage("");
  };

  const d = decoded;
  const decodedRows = d
    ? [
        ["Year", d.year],
        ["Make", d.make],
        ["Manufacturer", d.manufacturer],
        ["Model", d.model],
        ["Trim", d.trim],
        ["Body class", d.bodyClass],
        ["Fuel type", d.fuelTypePrimary],
        ["Drive type", d.driveType],
        ["Transmission", d.transmissionStyle],
      ].filter(([, v]) => v != null && v !== "")
    : [];

  return (
    <s-page heading="Add vehicle">
      <s-section heading="Add vehicle">
        <s-paragraph>
          Enter VIN, decode, set Title and Miles, then add to store. All fields are on this page.
        </s-paragraph>

        {productId && (
          <>
            <s-banner tone="success">
              Product added and published to your store.
            </s-banner>
            {actionWarnings.length > 0 && (
              <s-banner tone="warning" style={{ marginTop: "0.5rem" }}>
                Completed with warnings:
                <ul style={{ margin: "0.25rem 0 0 1rem", paddingLeft: "0.5rem" }}>
                  {actionWarnings.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </s-banner>
            )}
            <s-stack direction="inline" gap="base" style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
              {productAdminUrl(shop, productId) && (
                <a
                  href={productAdminUrl(shop, productId)}
                  target="_top"
                  rel="noopener noreferrer"
                  style={{ color: "var(--p-color-text-link)", fontWeight: 600 }}
                >
                  Open product in Shopify
                </a>
              )}
              <s-button type="button" variant="primary" onClick={handleAddAnother}>
                Add another vehicle
              </s-button>
            </s-stack>
          </>
        )}

        <form onSubmit={handleDecode}>
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="VIN"
              value={vin}
              onInput={(e) => setVin((e.target?.value ?? "").toUpperCase().slice(0, VIN_LENGTH))}
              placeholder="e.g. 1HGBH41JXMN109186"
              maxLength={VIN_LENGTH}
              helpText={`${vin.length}/${VIN_LENGTH} characters`}
            />
            <s-button
              type="submit"
              variant="secondary"
              disabled={vin.trim().length < 8 || isBusy}
              {...(isBusy ? { loading: true } : {})}
            >
              {isBusy ? "Working…" : "Decode VIN"}
            </s-button>
          </s-stack>
        </form>

        {decoded ? (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued" style={{ marginTop: "1rem" }}>
              <s-stack direction="block" gap="base">
                {decodedRows.map(([label, value]) => (
                  <s-stack key={label} direction="inline" gap="base">
                    <s-text type="strong">{label}:</s-text>
                    <s-text>{value}</s-text>
                  </s-stack>
                ))}
              </s-stack>
            </s-box>
        ) : (
          <s-paragraph tone="subdued" style={{ marginTop: "1rem" }}>
            Enter a VIN and click Decode VIN to see vehicle details.
          </s-paragraph>
        )}

        <s-stack direction="block" gap="base" style={{ marginTop: "1.5rem" }}>
              <s-stack direction="inline" gap="base">
                <label htmlFor="add-vehicle-title" style={{ fontWeight: 600 }}>
                  Title
                </label>
                <select
                  id="add-vehicle-title"
                  value={titleStatus}
                  onChange={(e) => setTitleStatus(e.target.value)}
                  style={{ padding: "0.5rem", minWidth: "10rem" }}
                >
                  {TITLE_OPTIONS.map((opt) => (
                    <option key={opt || "blank"} value={opt}>
                      {opt || "— Select —"}
                    </option>
                  ))}
                </select>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-text-field
                  label="Miles"
                  type="number"
                  value={mileage}
                  onInput={(e) => setMileage(e.target?.value ?? "")}
                  placeholder="e.g. 45000"
                  min={0}
                />
              </s-stack>
            </s-stack>
            <form onSubmit={handleAddToStore} style={{ marginTop: "1.5rem" }}>
              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={vin.trim().length < 8 || isBusy}
                  {...(isBusy ? { loading: true } : {})}
                >
                  {isBusy ? "Working…" : "Add to store"}
                </s-button>
              </s-stack>
            </form>

        {actionError && (
          <s-banner tone="critical" slot="after" style={{ marginTop: "1rem" }}>
            {actionError}
          </s-banner>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
