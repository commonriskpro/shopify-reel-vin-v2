/**
 * Product service: create from VIN, create full. Uses GraphQL wrapper only. Returns warnings for inventory/location.
 */
import { runGraphQL, runGraphQLWithUserErrors } from "../lib/shopify-graphql.server.js";
import {
  vehicleDescriptionFromDecoded,
  vehicleTitleFromDecoded,
  tagsFromDecoded,
} from "./vins.server.js";
import { normalizeTransmission } from "../lib/vin.server.js";

/** Strip control chars and fix invalid UTF-8 so GraphQL/JSON never sees broken payloads (avoids "syntax error, unexpected end of file"). */
function sanitizeForGraphQL(s) {
  if (s == null || typeof s !== "string") return s;
  return s
    .replace(/\u0000/g, "") // null byte
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control chars except \t \n \r
    .replace(/\uFFFD/g, ""); // strip replacement chars from prior bad UTF-8
}

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ vin: string; title: string; decoded?: object | null; titleStatus?: string; mileage?: number | string }} options
 * @returns {Promise<{ productId: string; product: { id: string }; decoded?: object; warnings?: Array<{ code: string; message: string }> }>}
 */
export async function createProductFromVin(admin, options) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const { vin, title, decoded = null, titleStatus, mileage } = options;
  const safeTitle = String(title || "").trim().slice(0, 255);
  if (!safeTitle) throw new Error("Missing vehicle title.");

  const vinForNote = String(vin || "").trim();
  const productInput = { title: safeTitle, status: "ACTIVE", productType: "Vehicles" };

  try {
    const { data } = await runGraphQL(graphql, {
      query: `#graphql query getVehiclesCategory { taxonomy { categories(first: 30, search: "Vehicles") { nodes { id name fullName } } } }`,
    });
    const nodes = data?.taxonomy?.categories?.nodes ?? [];
    const vehiclesCategory = nodes.find((n) => n?.name === "Vehicles" || n?.fullName === "Vehicles");
    if (vehiclesCategory?.id) productInput.category = vehiclesCategory.id;
  } catch (_) {}

  if (decoded) {
    const desc = vehicleDescriptionFromDecoded(decoded, vinForNote);
    if (desc) productInput.descriptionHtml = desc;
    const tags = tagsFromDecoded(decoded);
    if (tags?.length) productInput.tags = tags;
    if (decoded.manufacturer) productInput.vendor = decoded.manufacturer;
  }

  const { data } = await runGraphQLWithUserErrors(graphql, {
    query: `#graphql
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title status }
        userErrors { field message }
      }
    }`,
    variables: { product: productInput },
  }, "productCreate");

  const product = data?.productCreate?.product;
  if (!product?.id) throw new Error("Could not create product.");
  const productId = product.id;

  const metafieldsPayload = [
    { namespace: "vin_decoder", key: "vin", type: "single_line_text_field", value: vinForNote },
    { namespace: "vin_decoder", key: "decoded", type: "json", value: JSON.stringify({ ...(decoded || {}), vin: vinForNote }) },
    ...(decoded?.year != null ? [{ namespace: "vin_decoder", key: "year", type: "single_line_text_field", value: String(decoded.year) }] : []),
    ...(decoded?.make ? [{ namespace: "vin_decoder", key: "make", type: "single_line_text_field", value: decoded.make }] : []),
    ...(decoded?.model ? [{ namespace: "vin_decoder", key: "model", type: "single_line_text_field", value: decoded.model }] : []),
    ...(decoded?.driveType ? [{ namespace: "vin_decoder", key: "drivetrain", type: "single_line_text_field", value: decoded.driveType }] : []),
    ...(decoded?.fuelTypePrimary ? [{ namespace: "vin_decoder", key: "fuel_type", type: "single_line_text_field", value: decoded.fuelTypePrimary }] : []),
    ...(() => { const t = normalizeTransmission(decoded?.transmissionStyle); return t ? [{ namespace: "vin_decoder", key: "transmission", type: "single_line_text_field", value: t }] : []; })(),
  ];
  const validTitleStatuses = ["Clean", "Salvage", "Rebuilt", "Junk"];
  if (titleStatus && validTitleStatuses.includes(String(titleStatus).trim())) {
    metafieldsPayload.push({ namespace: "vin_decoder", key: "title_status", type: "single_line_text_field", value: String(titleStatus).trim() });
  }
  if (mileage != null && mileage !== "") {
    const mileageNum = typeof mileage === "number" ? mileage : parseInt(String(mileage).replace(/\D/g, ""), 10);
    if (!Number.isNaN(mileageNum)) {
      metafieldsPayload.push({ namespace: "vin_decoder", key: "mileage", type: "number_integer", value: String(mileageNum) });
    }
  }

  const warnings = [];

  if (metafieldsPayload.length > 0) {
    try {
      await runGraphQLWithUserErrors(graphql, {
        query: `#graphql mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }`,
        variables: { input: { id: productId, metafields: metafieldsPayload } },
      }, "productUpdate");
    } catch (_) {}
  }

  let inventoryError = null;
  if (vinForNote && vinForNote.length >= 6) {
    const last6 = vinForNote.trim().toUpperCase().slice(-6);
    const { data: vData } = await runGraphQL(graphql, {
      query: `#graphql query getFirstVariant($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id inventoryItem { id } } } } }`,
      variables: { id: productId },
    });
    const variantNode = vData?.product?.variants?.nodes?.[0];
    if (variantNode?.id) {
      try {
        await runGraphQLWithUserErrors(graphql, {
          query: `#graphql mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
          }`,
          variables: { productId, variants: [{ id: variantNode.id, inventoryItem: { sku: last6, tracked: true } }] },
        }, "productVariantsBulkUpdate");
      } catch (_) {}

      const invItemId = variantNode.inventoryItem?.id;
      if (invItemId) {
        await new Promise((r) => setTimeout(r, 800));
        let locationId = null;
        try {
          const { data: locData } = await runGraphQL(graphql, { query: `#graphql query getLocations { locations(first: 10) { nodes { id name } } }` });
          const nodes = locData?.locations?.nodes ?? [];
          const location = nodes.find((n) => /shop|main|primary|store/i.test(n?.name || "")) || nodes[0];
          locationId = location?.id;
        } catch (_) {}

        if (locationId) {
          try {
            await runGraphQLWithUserErrors(graphql, {
              query: `#graphql mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
                inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) { inventoryLevel { id } userErrors { message } }
              }`,
              variables: { inventoryItemId: invItemId, locationId, available: 1 },
            }, "inventoryActivate");

            const { data: setQtyData } = await runGraphQL(graphql, {
              query: `#graphql mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
                inventorySetQuantities(input: $input) { userErrors { code message } }
              }`,
              variables: {
                input: {
                  name: "available",
                  reason: "correction",
                  ignoreCompareQuantity: true,
                  quantities: [{ inventoryItemId: invItemId, locationId, quantity: 1 }],
                },
              },
            });
            const setQtyErrs = setQtyData?.inventorySetQuantities?.userErrors ?? [];
            if (setQtyErrs.length > 0) inventoryError = setQtyErrs.map((e) => e.message || e.code).join("; ");
          } catch (err) {
            inventoryError = err?.message ?? String(err);
          }
        } else {
          inventoryError = "Could not find a location for inventory.";
        }
      }
    }
  }

  if (inventoryError) warnings.push({ code: "INVENTORY_NOT_SET", message: inventoryError });

  return {
    productId,
    product: { id: productId },
    ...(decoded && { decoded }),
    ...(warnings.length > 0 && { warnings }),
  };
}

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {object} options - title, descriptionHtml, vendor, productType, tags, status, categoryId, templateSuffix, seoTitle, seoDescription, price, compareAtPrice, cost, sku, barcode, trackInventory, sellWhenOutOfStock, metafields, vin, decoded, media
 * @returns {Promise<{ productId: string; product: { id: string; title?: string; status?: string }; warnings?: Array<{ code: string; message: string }> }>}
 */
export async function createProductFull(admin, options) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const {
    title,
    descriptionHtml,
    vendor,
    productType,
    tags,
    status = "ACTIVE",
    categoryId,
    templateSuffix,
    seoTitle,
    seoDescription,
    price,
    compareAtPrice,
    cost,
    sku,
    barcode,
    trackInventory = true,
    sellWhenOutOfStock = false,
    metafields = [],
    vin,
    decoded,
    media: mediaInput = [],
  } = options;

  const safeTitle = sanitizeForGraphQL(String(title || "").trim()).slice(0, 255);
  if (!safeTitle) throw new Error("Title is required.");

  const productInput = {
    title: safeTitle,
    status,
    productType: sanitizeForGraphQL(productType?.trim()) || "Vehicles",
  };
  // Keep GraphQL variables small and safe (no control chars) to avoid "syntax error, unexpected end of file"
  const MAX_DESCRIPTION_CHARS = 100_000;
  if (descriptionHtml != null && descriptionHtml !== "") {
    productInput.descriptionHtml = sanitizeForGraphQL(String(descriptionHtml)).slice(0, MAX_DESCRIPTION_CHARS);
  }
  const safeVendor = sanitizeForGraphQL(vendor?.trim());
  if (safeVendor) productInput.vendor = safeVendor;
  if (Array.isArray(tags) && tags.length) {
    productInput.tags = tags.filter(Boolean).map((t) => sanitizeForGraphQL(String(t).trim()));
  }
  if (categoryId?.trim()) productInput.category = sanitizeForGraphQL(categoryId.trim());
  if (templateSuffix?.trim()) productInput.templateSuffix = sanitizeForGraphQL(templateSuffix.trim());
  if (seoTitle != null || seoDescription != null) {
    productInput.seo = {};
    if (seoTitle != null) productInput.seo.title = sanitizeForGraphQL(String(seoTitle).trim()).slice(0, 70);
    if (seoDescription != null) productInput.seo.description = sanitizeForGraphQL(String(seoDescription).trim()).slice(0, 320);
  }

  const mediaForApi = Array.isArray(mediaInput)
    ? mediaInput
        .filter((m) => m && m.originalSource && m.mediaContentType)
        .map((m) => ({
          originalSource: String(m.originalSource),
          mediaContentType: String(m.mediaContentType).toUpperCase() === "VIDEO" ? "VIDEO" : "IMAGE",
          alt: m.alt != null ? String(m.alt).slice(0, 512) : undefined,
        }))
    : [];

  // Only include media in the mutation when there are actual media items.
  // Passing an empty array can cause Shopify to return "syntax error, unexpected end of file".
  const hasMedia = mediaForApi.length > 0;

  // Retry once on transient GraphQL errors (empty/truncated response from Shopify).
  let createData;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await runGraphQLWithUserErrors(graphql, {
        query: hasMedia
          ? `#graphql mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) { product { id title status } userErrors { field message } } }`
          : `#graphql mutation productCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id title status } userErrors { field message } } }`,
        variables: hasMedia
          ? { product: productInput, media: mediaForApi }
          : { product: productInput },
      }, "productCreate");
      createData = result.data;
      break;
    } catch (err) {
      const isTransient = /syntax error|unexpected end of file|graphql_parse|graphql_error/i.test(err?.message ?? err?.code ?? "");
      if (attempt < 2 && isTransient) {
        console.warn(`[createProductFull] productCreate transient error (attempt ${attempt}), retrying in 1s: ${err?.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        throw err;
      }
    }
  }

  const product = createData?.productCreate?.product;
  if (!product?.id) throw new Error("Could not create product.");
  const productId = product.id;

  // All post-create steps are best-effort — if they fail, the product still exists.
  // We return warnings instead of failing so users don't see a 502 for an already-created product.
  const warnings = [];
  let variantNode = null;
  try {
    const { data: vData } = await runGraphQL(graphql, {
      query: `#graphql query getFirstVariant($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id inventoryItem { id } } } } }`,
      variables: { id: productId },
    });
    variantNode = vData?.product?.variants?.nodes?.[0] ?? null;
  } catch (err) {
    console.warn("[createProductFull] getFirstVariant failed (non-fatal):", err?.message);
    warnings.push({ code: "VARIANT_NOT_UPDATED", message: "Could not fetch variant to set price/SKU (product was created)." });
  }

  if (variantNode?.id) {
    const variantUpdates = {};
    if (price != null && price !== "") {
      const p = parseFloat(String(price).replace(/[^0-9.-]/g, ""));
      if (!Number.isNaN(p)) variantUpdates.price = String(p);
    }
    if (compareAtPrice != null && compareAtPrice !== "") {
      const cp = parseFloat(String(compareAtPrice).replace(/[^0-9.-]/g, ""));
      if (!Number.isNaN(cp)) variantUpdates.compareAtPrice = String(cp);
    }
    if (sku?.trim()) variantUpdates.sku = sku.trim();
    if (barcode?.trim()) variantUpdates.barcode = barcode.trim();
    // Note: cost is set via inventoryItem.unitCost, not a top-level variant field.
    variantUpdates.tracked = Boolean(trackInventory);
    variantUpdates.inventoryPolicy = sellWhenOutOfStock ? "CONTINUE" : "DENY";

    if (Object.keys(variantUpdates).length > 0) {
      try {
        await runGraphQLWithUserErrors(graphql, {
          query: `#graphql mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
          }`,
          variables: { productId, variants: [{ id: variantNode.id, ...variantUpdates }] },
        }, "productVariantsBulkUpdate");
      } catch (_) {}
    }

    if (variantNode.inventoryItem?.id && trackInventory) {
      const invItemId = variantNode.inventoryItem.id;
      let locationId = null;
      try {
        const { data: locData } = await runGraphQL(graphql, { query: `#graphql query getLocations { locations(first: 10) { nodes { id name } } }` });
        const nodes = locData?.locations?.nodes ?? [];
        locationId = (nodes.find((n) => /shop|main|primary|store/i.test(n?.name || "")) || nodes[0])?.id;
      } catch (_) {}
      if (locationId) {
        try {
          await runGraphQLWithUserErrors(graphql, {
            query: `#graphql mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
              inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) { inventoryLevel { id } userErrors { message } }
            }`,
            variables: { inventoryItemId: invItemId, locationId, available: 1 },
          }, "inventoryActivate");
        } catch (err) {
          warnings.push({ code: "INVENTORY_NOT_SET", message: err?.message ?? "Could not activate inventory." });
        }
      } else {
        warnings.push({ code: "INVENTORY_NOT_SET", message: "Could not find a location for inventory." });
      }
    }
  }

  const vinForNote = (vin && String(vin).trim()) || "";
  const vinDecoderMetafields = [];
  if (vinForNote && decoded && typeof decoded === "object") {
    vinDecoderMetafields.push(
      { namespace: "vin_decoder", key: "vin", type: "single_line_text_field", value: vinForNote },
      { namespace: "vin_decoder", key: "decoded", type: "json", value: JSON.stringify({ ...decoded, vin: vinForNote }) }
    );
    if (decoded.year != null) vinDecoderMetafields.push({ namespace: "vin_decoder", key: "year", type: "single_line_text_field", value: String(decoded.year) });
    if (decoded.make) vinDecoderMetafields.push({ namespace: "vin_decoder", key: "make", type: "single_line_text_field", value: decoded.make });
    if (decoded.model) vinDecoderMetafields.push({ namespace: "vin_decoder", key: "model", type: "single_line_text_field", value: decoded.model });
    if (decoded.driveType) vinDecoderMetafields.push({ namespace: "vin_decoder", key: "drivetrain", type: "single_line_text_field", value: decoded.driveType });
    if (decoded.fuelTypePrimary) vinDecoderMetafields.push({ namespace: "vin_decoder", key: "fuel_type", type: "single_line_text_field", value: decoded.fuelTypePrimary });
    const normTransmission = normalizeTransmission(decoded.transmissionStyle);
    if (normTransmission) vinDecoderMetafields.push({ namespace: "vin_decoder", key: "transmission", type: "single_line_text_field", value: normTransmission });
  }

  const allMetafields = [...metafields, ...vinDecoderMetafields];
  if (allMetafields.length > 0) {
    try {
      await runGraphQLWithUserErrors(graphql, {
        query: `#graphql mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }`,
        variables: { input: { id: productId, metafields: allMetafields.map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value })) } },
      }, "productUpdate");
    } catch (_) {}
  }

  return {
    productId,
    product: { id: productId, title: product.title, status: product.status },
    ...(warnings.length > 0 && { warnings }),
  };
}
