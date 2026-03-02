import { useCallback, useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { logServerError } from "../http.server.js";
import { decodeVin, vehicleTitleFromDecoded } from "../services/vins.server.js";
import { createProductFromVin } from "../services/products.server.js";
import { enforceRateLimit, isValidVin, normalizeVin } from "../security.server.js";
import { getWarnings } from "../lib/api-client.js";
import { useApiClient } from "../lib/api.client.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session?.shop ?? "" };
};

const actionBodySchema = z.object({
  title: z.string().optional(),
  vin: z.string().optional(),
  decodeAndCreateDraft: z.boolean().optional(),
  titleStatus: z.string().optional(),
  mileage: z.union([z.string(), z.number()]).optional(),
}).passthrough();

export const action = async ({ request }) => {
  if (request.method !== "POST") return null;
  const { admin, session } = await authenticate.admin(request);
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
  const { title: lineTitle, vin, decodeAndCreateDraft, titleStatus, mileage } = bodyParse.data;
  const normalizedVin = normalizeVin(vin);
  if (normalizedVin && !isValidVin(normalizedVin)) {
    return Response.json({ error: "Please provide a valid VIN (8-17 characters)." }, { status: 400 });
  }
  let titleForProduct = lineTitle;
  let decodedForResponse = null;
  let vinForNote = normalizedVin || "";

  if (decodeAndCreateDraft && vinForNote) {
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
    try {
      const { decoded } = await decodeVin(vinForNote);
      decodedForResponse = decoded;
      titleForProduct = vehicleTitleFromDecoded(decoded);
      vinForNote = decoded.vin || vinForNote;
    } catch (err) {
      logServerError("admin._index.decodeVin", err, { shop: session?.shop });
      return Response.json(
        { error: "Failed to decode VIN." },
        { status: 502 }
      );
    }
  } else if (vinForNote && (!titleForProduct || typeof titleForProduct !== "string")) {
    return Response.json({ error: "Missing vehicle title or VIN for decode" }, { status: 400 });
  } else if (vinForNote && !decodedForResponse) {
    try {
      const { decoded } = await decodeVin(vinForNote);
      decodedForResponse = decoded;
      if (!titleForProduct || typeof titleForProduct !== "string") {
        titleForProduct = vehicleTitleFromDecoded(decoded);
      }
      vinForNote = decoded.vin || vinForNote;
    } catch {
      decodedForResponse = null;
    }
  }
  if (!titleForProduct || typeof titleForProduct !== "string") {
    return Response.json({ error: "Missing vehicle title or VIN for decode" }, { status: 400 });
  }

  const safeTitle = String(titleForProduct || "").trim();
  if (!safeTitle) {
    return Response.json({ error: "Missing vehicle title or VIN for decode" }, { status: 400 });
  }

  try {
    const result = await createProductFromVin(admin, {
      vin: vinForNote,
      title: safeTitle,
      decoded: decodedForResponse ?? undefined,
      titleStatus: titleStatus ?? undefined,
      mileage: mileage ?? undefined,
    });
    const inventoryError = result.warnings?.find((w) => w.code === "INVENTORY_NOT_SET")?.message;
    if (decodeAndCreateDraft && decodedForResponse) {
      return Response.json({
        decoded: decodedForResponse,
        product: result.product,
        ...(inventoryError && { inventoryError }),
      });
    }
    return Response.json({
      product: result.product,
      ...(inventoryError && { inventoryError }),
    });
  } catch (err) {
    logServerError("admin._index.createProduct", err, { shop: session?.shop });
    return Response.json(
      { error: err?.message || "Could not create product." },
      { status: err?.message?.includes("valid") ? 400 : 502 }
    );
  }
};

const VIN_LENGTH = 17;
const DECODE_API = "/api/vins";

function DecodedResult({ data, onCreateDraft, onOpenDraft, draftFetcher }) {
  const d = data?.decoded;
  if (!d) return null;
  const title = [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ");
  const rows = [
    ["Year", d.year],
    ["Make", d.make],
    ["Manufacturer", d.manufacturer],
    ["Model", d.model],
    ["Series", d.series],
    ["Trim", d.trim],
    ["Body class", d.bodyClass],
    ["Vehicle type", d.vehicleType],
    ["Engine cylinders", d.engineCylinders],
    ["Displacement (L)", d.displacementL],
    ["Fuel type", d.fuelTypePrimary],
    ["Drive type", d.driveType],
    ["Transmission", d.transmissionStyle],
    ["Plant", [d.plantCity, d.plantState, d.plantCountry].filter(Boolean).join(", ") || "—"],
  ].filter(([, v]) => v != null && v !== "");
  return (
    <s-section heading={title || "Decoded vehicle"}>
      <s-box
        padding="base"
        borderWidth="base"
        borderRadius="base"
        background="subdued"
      >
        <s-stack direction="block" gap="base">
          {rows.map(([label, value]) => (
            <s-stack key={label} direction="inline" gap="base">
              <s-text type="strong">{label}:</s-text>
              <s-text>{value}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-box>
      {(d.errorCode || d.errorText) && (
        <s-banner tone="warning" slot="after">
          {d.errorText}
        </s-banner>
      )}
      {onCreateDraft && (
        <s-stack direction="inline" gap="base" slot="after">
          <s-button
            variant="primary"
            onClick={onCreateDraft}
            disabled={draftFetcher?.state === "submitting" || draftFetcher?.state === "loading"}
            {...(draftFetcher?.state === "submitting" ? { loading: true } : {})}
          >
            Create product
          </s-button>
          {onOpenDraft && draftFetcher?.data?.product?.id && (
            <s-button variant="secondary" onClick={onOpenDraft}>
              Open product in Shopify
            </s-button>
          )}
        </s-stack>
      )}
    </s-section>
  );
}

function productAdminUrl(shop, productIdGid) {
  if (!shop || !productIdGid) return null;
  const numericId = productIdGid.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!numericId) return null;
  return `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/products/${numericId}`;
}

export default function Index() {
  const { shop } = useLoaderData() ?? {};
  const { apiGet } = useApiClient();
  const [vin, setVin] = useState("");
  const [createdProducts, setCreatedProducts] = useState([]);
  const [decodeLoading, setDecodeLoading] = useState(false);
  const [decodeResult, setDecodeResult] = useState(null);
  const shopify = useAppBridge();
  const draftFetcher = useFetcher();
  const isLoading = decodeLoading;
  const decodeError = decodeResult?.ok === false ? decodeResult?.error?.message : null;
  const decodeRequestId = decodeResult?.ok === false ? decodeResult?.meta?.requestId : null;
  const draftError = typeof draftFetcher.data?.error === "string" ? draftFetcher.data.error : draftFetcher.data?.error?.message;
  const error = decodeError || draftError;

  const handleDecode = useCallback(async () => {
    const v = vin.trim().toUpperCase();
    if (v.length < 8) return;
    setDecodeLoading(true);
    setDecodeResult(null);
    try {
      const res = await apiGet(`${DECODE_API}?vin=${encodeURIComponent(v)}`);
      setDecodeResult(res);
    } finally {
      setDecodeLoading(false);
    }
  }, [vin, apiGet]);

  const handleDecodeAndCreateDraft = () => {
    const v = vin.trim().toUpperCase();
    if (v.length < 8) return;
    draftFetcher.submit(
      { vin: v, decodeAndCreateDraft: true },
      { method: "POST", encType: "application/json" }
    );
  };

  const decodePayload = decodeResult?.ok === true ? decodeResult?.data : null;
  const draftPayload = draftFetcher.data?.ok === true ? draftFetcher.data?.data : draftFetcher.data;
  const decodedData = decodePayload?.decoded
    ? { decoded: decodePayload.decoded, raw: decodePayload.raw }
    : draftPayload?.decoded
      ? { decoded: draftPayload.decoded }
      : null;

  const vehicleTitle = decodedData?.decoded
    ? [decodedData.decoded.year, decodedData.decoded.make, decodedData.decoded.model, decodedData.decoded.trim]
        .filter(Boolean)
        .join(" ")
        .trim() || decodedData.decoded.vehicleType || "Vehicle"
    : "";

  const handleCreateDraft = () => {
    if (!vehicleTitle) return;
    draftFetcher.submit(
      { title: vehicleTitle, vin: vin.trim() },
      { method: "POST", encType: "application/json" }
    );
  };

  const handleOpenDraft = () => {
    const id = draftFetcher.data?.product?.id;
    if (!id) return;
    const url = productAdminUrl(shop, id);
    if (url) window.open(url, "_top");
  };

  useEffect(() => {
    const id = draftFetcher.data?.product?.id;
    if (!id) return;
    shopify.toast?.show?.("Product added to store");
    setCreatedProducts((prev) => {
      if (prev.some((d) => d.id === id)) return prev;
      const label =
        vehicleTitle ||
        (draftFetcher.data?.decoded
          ? [draftFetcher.data.decoded.year, draftFetcher.data.decoded.make, draftFetcher.data.decoded.model, draftFetcher.data.decoded.trim]
              .filter(Boolean)
              .join(" ")
              .trim() || "Vehicle"
          : "Product");
      return [{ id, label }, ...prev];
    });
  }, [draftFetcher.data?.product?.id, vehicleTitle, draftFetcher.data?.decoded, shopify]);

  const openProductById = (productId) => {
    const url = productAdminUrl(shop, productId);
    if (url) window.open(url, "_top");
  };

  return (
    <s-page heading="VIN Decoder">
      <s-section heading="Decode a vehicle VIN">
        <s-paragraph>
          Enter a 17-character Vehicle Identification Number to decode year, make,
          model, and other details. Data is provided by NHTSA for car dealership
          use.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-text-field
            label="VIN"
            value={vin}
            onInput={(e) => setVin((e.target?.value ?? "").toUpperCase().slice(0, VIN_LENGTH))}
            placeholder="e.g. 1HGBH41JXMN109186"
            maxLength={VIN_LENGTH}
            helpText={`${vin.length}/${VIN_LENGTH} characters (letters and numbers, no I/O/Q)`}
          />
          <s-button
            variant="primary"
            onClick={handleDecode}
            disabled={vin.trim().length < 8 || isLoading}
            {...(isLoading ? { loading: true } : {})}
          >
            Decode VIN
          </s-button>
          <s-button
            variant="secondary"
            onClick={handleDecodeAndCreateDraft}
            disabled={vin.trim().length < 8 || isLoading || draftFetcher.state !== "idle"}
            {...(draftFetcher.state !== "idle" ? { loading: true } : {})}
          >
            {draftFetcher.state !== "idle" ? "Working…" : "Decode and add to store"}
          </s-button>
        </s-stack>
        {error && (
          <s-banner tone="critical" slot="after">
            {error}
            {(decodeRequestId || draftFetcher.data?.meta?.requestId) && (
              <span style={{ display: "block", marginTop: "6px", fontSize: "12px", opacity: 0.9 }}>
                Request ID: <code style={{ userSelect: "all", cursor: "text" }}>{decodeRequestId || draftFetcher.data?.meta?.requestId}</code>
              </span>
            )}
          </s-banner>
        )}
        {draftFetcher.data?.product?.id && getWarnings(draftFetcher.data).length > 0 && (
          <s-banner tone="warning" slot="after">
            Completed with warnings:
            <ul style={{ margin: "0.25rem 0 0 1rem", paddingLeft: "0.5rem" }}>
              {getWarnings(draftFetcher.data).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </s-banner>
        )}
      </s-section>
      {decodedData && (
        <DecodedResult
          data={decodedData}
          onCreateDraft={handleCreateDraft}
          onOpenDraft={handleOpenDraft}
          draftFetcher={draftFetcher}
        />
      )}
      <s-section slot="aside" heading="Where to use it">
        <s-paragraph>
          Enter a VIN and click <s-text type="strong">Decode and add to store</s-text> to
          create a published product with the vehicle details in one step, or decode first
          then choose &quot;Create product&quot; below. Add a vehicle in a guided flow:{" "}
          <s-link href="/admin/add-vehicle">Add vehicle</s-link>.
        </s-paragraph>
        <s-paragraph>
          You can also decode and apply vehicle info to a product from the{" "}
          <s-text type="strong">product details page</s-text> in Admin: open a
          car product and click the &quot;VIN Decoder&quot; action.
        </s-paragraph>
      </s-section>
      {createdProducts.length > 0 && (
        <s-section slot="aside" heading="Products added">
          <s-paragraph>
            Open a product to add price, images, or edit details.
          </s-paragraph>
          <s-stack direction="block" gap="tight">
            {createdProducts.map((item) => {
              const url = productAdminUrl(shop, item.id);
              return (
                <s-stack key={item.id} direction="inline" gap="base">
                  {url ? (
                    <a
                      href={url}
                      target="_top"
                      rel="noopener noreferrer"
                      style={{ color: "var(--p-color-text-link)", textDecoration: "underline", fontWeight: 500 }}
                    >
                      {item.label}
                    </a>
                  ) : (
                    <s-button
                      variant="tertiary"
                      onClick={() => openProductById(item.id)}
                    >
                      {item.label}
                    </s-button>
                  )}
                </s-stack>
              );
            })}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
