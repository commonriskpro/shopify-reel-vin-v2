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
 * Publish a product to the Online Store sales channel. Requires read_publications + write_publications scope.
 * @param {import("@shopify/shopify-api").AdminApiContext["graphql"]} graphql
 * @param {string} productId - GID
 * @returns {Promise<string | null>} Warning message if publish failed, null if success or skip
 */
async function publishProductToOnlineStore(graphql, productId) {
  try {
    const { data: pubData } = await runGraphQL(graphql, {
      query: `#graphql query getPublications { publications(first: 15) { nodes { id name } } }`,
    });
    const pubNodes = pubData?.publications?.nodes ?? [];
    const onlineStorePub = pubNodes.find((p) => /online store/i.test(p?.name ?? "")) ?? pubNodes[0];
    if (!onlineStorePub?.id) return "No Online Store publication found. Add read_publications scope and reinstall.";
    const { data: pubMutData } = await runGraphQL(graphql, {
      query: `#graphql mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { publishable { availablePublicationsCount { count } } userErrors { field message } }
      }`,
      variables: { id: productId, input: [{ publicationId: onlineStorePub.id }] },
    });
    const userErrors = pubMutData?.publishablePublish?.userErrors ?? [];
    const msg = userErrors.map((e) => e?.message ?? "").join(" ");
    if (userErrors.length > 0 && !/already published|already active|already included/i.test(msg)) {
      return "Publish failed: " + msg;
    }
    return null;
  } catch (err) {
    const m = err?.message ?? "";
    if (/already published|already active|access denied|unknown field.*publications/i.test(m)) return null;
    return "Could not publish to Online Store. Add read_publications,write_publications to app scopes and reinstall. " + (m ? m.slice(0, 80) : "");
  }
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

  const warnings = [];
  const publishWarn = await publishProductToOnlineStore(graphql, productId);
  if (publishWarn) warnings.push({ code: "PUBLISH_SKIPPED", message: publishWarn });

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
            const qtyMsgs = setQtyErrs
              .map((e) => e.message || e.code)
              .filter((m) => !/already active|not allowed to set available quantity when the item is already active/i.test(m));
            if (qtyMsgs.length > 0) inventoryError = qtyMsgs.join("; ");
          } catch (err) {
            const msg = err?.message ?? String(err);
            if (!/already active|not allowed to set available quantity when the item is already active/i.test(msg)) {
              inventoryError = msg;
            }
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
    titleStatus,
    mileage,
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
  const hasMedia = mediaForApi.length > 0;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: "CREATE_PRODUCT_START",
    titleLen: (productInput.title || "").length,
    descriptionLen: (productInput.descriptionHtml || "").length,
    hasMedia,
    mediaCount: mediaForApi.length,
  }));

  let productId;
  let product = { id: null, title: productInput.title, status: productInput.status };

  try {
    const result = await runGraphQLWithUserErrors(graphql, {
      query: hasMedia
        ? `#graphql mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) { product { id title status } userErrors { field message } } }`
        : `#graphql mutation productCreate($product: ProductCreateInput!) { productCreate(product: $product) { product { id title status } userErrors { field message } } }`,
      variables: hasMedia
        ? { product: productInput, media: mediaForApi }
        : { product: productInput },
    }, "productCreate");
    const createData = result.data?.productCreate?.product;
    if (createData?.id) {
      productId = createData.id;
      product = createData;
    }
  } catch (err) {
    const isLikelyResponseTruncated = /syntax error|unexpected end of file|graphql_parse|failed to parse/i.test(err?.message ?? err?.code ?? "");
    if (isLikelyResponseTruncated) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        event: "CREATE_PRODUCT_RECOVERY_ATTEMPT",
        errCode: err?.code,
        errMessage: (err?.message ?? "").slice(0, 150),
      }));
      try {
        const { data: listData } = await runGraphQL(graphql, {
          query: `#graphql query recentProducts { products(first: 15, sortKey: CREATED_AT, reverse: true) { nodes { id title status createdAt } } }`,
        });
        const nodes = listData?.products?.nodes ?? [];
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const wantTitle = (productInput.title || "").trim();
        const recent = nodes.find((n) => n?.id && n?.createdAt >= twoMinutesAgo && (n.title || "").trim() === wantTitle);
        if (recent?.id) {
          productId = recent.id;
          product = { id: recent.id, title: recent.title, status: recent.status };
          console.log(JSON.stringify({ ts: new Date().toISOString(), event: "CREATE_PRODUCT_RECOVERY_OK", productId: recent.id }));
        }
      } catch (recoveryErr) {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          event: "CREATE_PRODUCT_RECOVERY_FAIL",
          errCode: recoveryErr?.code,
          errMessage: (recoveryErr?.message ?? "").slice(0, 150),
        }));
      }
    }
    if (!productId) throw err;
  }

  if (!productId) throw new Error("Could not create product.");

  // All post-create steps are best-effort — if they fail, the product still exists.
  const warnings = [];

  const publishWarn = await publishProductToOnlineStore(graphql, productId);
  if (publishWarn) warnings.push({ code: "PUBLISH_SKIPPED", message: publishWarn });

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
    const variantUpdates = { id: variantNode.id };
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
    variantUpdates.inventoryPolicy = sellWhenOutOfStock ? "CONTINUE" : "DENY";
    // Tracked and cost live on inventoryItem; ProductVariantsBulkInput.inventoryItem accepts them.
    if (trackInventory) {
      variantUpdates.inventoryItem = { tracked: true };
      if (cost != null && cost !== "") {
        const costNum = parseFloat(String(cost).replace(/[^0-9.-]/g, ""));
        if (!Number.isNaN(costNum)) variantUpdates.inventoryItem.cost = String(costNum);
      }
    }

    if (Object.keys(variantUpdates).length > 1) {
      try {
        const { id: _id, ...rest } = variantUpdates;
        await runGraphQLWithUserErrors(graphql, {
          query: `#graphql mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
          }`,
          variables: { productId, variants: [{ id: variantNode.id, ...rest }] },
        }, "productVariantsBulkUpdate");
      } catch (err) {
        const msg = err?.message ?? "";
        if (!/USER_ERRORS/.test(String(err?.code))) throw err;
        warnings.push({ code: "VARIANT_NOT_UPDATED", message: msg || "Could not update variant price/inventory." });
      }
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
          const msg = err?.message ?? "";
          // "Already active at location" is success — don't warn
          if (!/already active|not allowed to set available quantity when the item is already active/i.test(msg)) {
            warnings.push({ code: "INVENTORY_NOT_SET", message: msg || "Could not activate inventory." });
          }
        }
        // Explicitly set quantity to 1 so "Available" and "On hand" show 1 by default (inventoryActivate can leave 0 on some API versions).
        try {
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
          const qtyMsgs = setQtyErrs.map((e) => e?.message || e?.code).filter(Boolean);
          if (qtyMsgs.length > 0 && !/already active|not allowed to set available quantity when the item is already active/i.test(qtyMsgs.join(" "))) {
            warnings.push({ code: "INVENTORY_NOT_SET", message: qtyMsgs.join("; ") });
          }
        } catch (_) {}
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
  const validTitleStatuses = ["Clean", "Rebuilt", "Salvage", "Junk", "Flood"];
  if (titleStatus && validTitleStatuses.includes(String(titleStatus).trim())) {
    vinDecoderMetafields.push({ namespace: "vin_decoder", key: "title_status", type: "single_line_text_field", value: String(titleStatus).trim() });
  }
  if (mileage != null && mileage !== "") {
    const mileageNum = typeof mileage === "number" ? mileage : parseInt(String(mileage).replace(/\D/g, ""), 10);
    if (!Number.isNaN(mileageNum) && mileageNum >= 0) {
      vinDecoderMetafields.push({ namespace: "vin_decoder", key: "mileage", type: "number_integer", value: String(mileageNum) });
    }
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

/**
 * List products (type Vehicles) that have VIN but missing Miles or Title metafield.
 * Used by Sync metafields page; keeps admin.graphql usage in services (Option A).
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @returns {Promise<Array<{ id: string; title: string; legacyResourceId: string; missingMiles: boolean; missingTitle: boolean }>>}
 */
export async function listProductsMissingMilesOrTitle(admin) {
  const graphql = admin?.graphql;
  if (!graphql) return [];
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
  const missing = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const { data } = await runGraphQL(graphql, { query, variables: after ? { after } : {} });
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
        const legacyId = p.id?.replace?.(/^gid:\/\/shopify\/Product\//, "") ?? "";
        missing.push({
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
  return missing;
}

/**
 * List products for admin product list page (Shopify-style table).
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ first?: number; after?: string | null; query?: string | null }} options
 * @returns {Promise<{ products: Array<{ id: string; title: string; status: string; legacyResourceId: string; featuredImageUrl: string | null; productType: string; categoryName: string | null; inventoryDisplay: string; channelsCount?: number }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } }>}
 */
export async function listProductsForAdmin(admin, { first = 50, after = null, query = null } = {}) {
  const graphql = admin?.graphql;
  if (!graphql) return { products: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const gqlQuery = `#graphql
    query adminProductList($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          status
          productType
          featuredImage { url }
          category { name fullName }
          variants(first: 1) {
            nodes {
              inventoryItem { id }
              sellableOnlineQuantity
            }
          }
          resourcePublicationsCount { count }
        }
      }
    }
  `;
  const variables = { first, after, query };
  if (query == null || query === "") delete variables.query;
  if (after == null || after === "") delete variables.after;
  const { data } = await runGraphQL(graphql, { query: gqlQuery, variables, operationName: "adminProductList" });
  const nodes = data?.products?.nodes ?? [];
  const pageInfo = data?.products?.pageInfo ?? { hasNextPage: false, endCursor: null };
  const products = nodes.map((p) => {
    const legacyResourceId = (p.id ?? "").replace(/^gid:\/\/shopify\/Product\//, "");
    const variant = p.variants?.nodes?.[0];
    const hasInventoryItem = variant?.inventoryItem?.id != null;
    const inventoryDisplay = !hasInventoryItem
      ? "Not tracked"
      : `${variant?.sellableOnlineQuantity ?? 0} in stock`;
    const categoryName = p.category?.fullName || p.category?.name || null;
    return {
      id: p.id,
      title: p.title ?? "Untitled",
      status: p.status ?? "DRAFT",
      legacyResourceId,
      featuredImageUrl: p.featuredImage?.url ?? null,
      productType: p.productType ?? "",
      categoryName,
      inventoryDisplay,
      channelsCount: p.resourcePublicationsCount?.count ?? 0,
    };
  });
  return { products, pageInfo };
}

/**
 * Get a single product for the in-app editor. Accepts GID or legacy numeric id.
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {string} productIdOrLegacy - GID (gid://shopify/Product/123) or legacy id (123)
 * @returns {Promise<{ id: string; title: string; descriptionHtml: string; vendor: string; productType: string; tags: string[]; status: string; categoryId: string | null; featuredImageUrl: string | null; variant: { id: string; price: string; compareAtPrice: string | null; sku: string | null; barcode: string | null; inventoryItemId: string | null; inventoryPolicy: string }; metafields: Array<{ namespace: string; key: string; value: string }> } | null>}
 */
export async function getProductForEditor(admin, productIdOrLegacy) {
  const graphql = admin?.graphql;
  if (!graphql) return null;
  const productId = productIdOrLegacy.startsWith("gid://")
    ? productIdOrLegacy
    : `gid://shopify/Product/${productIdOrLegacy.replace(/\D/g, "")}`;
  if (!productId.replace(/^gid:\/\/shopify\/Product\//, "")) return null;

  const query = `#graphql
    query getProductForEditor($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        vendor
        productType
        status
        tags
        category { id }
        featuredImage { url }
        variants(first: 1) {
          nodes {
            id
            price
            compareAtPrice
            sku
            barcode
            inventoryItem { id }
            inventoryPolicy
          }
        }
        metafields(namespace: "vin_decoder", first: 20) { namespace key value }
      }
    }
  `;
  const { data } = await runGraphQL(graphql, { query, variables: { id: productId }, operationName: "getProductForEditor" });
  const p = data?.product;
  if (!p?.id) return null;

  const variant = p.variants?.nodes?.[0];
  const metafields = (p.metafields ?? []).map((m) => ({ namespace: m.namespace, key: m.key, value: m.value ?? "" }));
  return {
    id: p.id,
    title: p.title ?? "",
    descriptionHtml: p.descriptionHtml ?? "",
    vendor: p.vendor ?? "",
    productType: p.productType ?? "Vehicles",
    tags: Array.isArray(p.tags) ? p.tags : [],
    status: p.status ?? "ACTIVE",
    categoryId: p.category?.id ?? null,
    featuredImageUrl: p.featuredImage?.url ?? null,
    variant: variant
      ? {
          id: variant.id,
          price: variant.price ?? "0",
          compareAtPrice: variant.compareAtPrice ?? null,
          sku: variant.sku ?? null,
          barcode: variant.barcode ?? null,
          inventoryItemId: variant.inventoryItem?.id ?? null,
          inventoryPolicy: variant.inventoryPolicy ?? "DENY",
        }
      : null,
    metafields,
  };
}

/**
 * Update an existing product (title, description, variant price, metafields). Does not replace media.
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {string} productIdGid
 * @param {object} payload - title, descriptionHtml, vendor, productType, tagsString, status, categoryId, price, compareAtPrice, sku, barcode, titleStatus, mileage, sellWhenOutOfStock
 */
export async function updateProduct(admin, productIdGid, payload) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const {
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
    titleStatus,
    mileage,
    sellWhenOutOfStock,
  } = payload;

  const productInput = {
    id: productIdGid,
    title: title != null ? sanitizeForGraphQL(String(title).trim().slice(0, 255)) : undefined,
    descriptionHtml: descriptionHtml != null ? sanitizeForGraphQL(descriptionHtml) : undefined,
    vendor: vendor != null ? sanitizeForGraphQL(String(vendor).trim()) : undefined,
    productType: productType != null ? sanitizeForGraphQL(String(productType).trim()) : undefined,
    status: status === "ACTIVE" || status === "DRAFT" || status === "ARCHIVED" ? status : undefined,
    category: categoryId?.trim() ? categoryId.trim() : undefined,
  };
  if (Array.isArray(tagsString)) {
    productInput.tags = tagsString.filter(Boolean).map((t) => sanitizeForGraphQL(String(t).trim()));
  } else if (typeof tagsString === "string") {
    productInput.tags = tagsString.split(",").map((t) => sanitizeForGraphQL(t.trim())).filter(Boolean);
  }

  await runGraphQLWithUserErrors(graphql, {
    query: `#graphql mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }`,
    variables: { input: productInput },
  }, "productUpdate");

  const { data: vData } = await runGraphQL(graphql, {
    query: `#graphql query getFirstVariant($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id inventoryItem { id } } } } }`,
    variables: { id: productIdGid },
  });
  const variantNode = vData?.product?.variants?.nodes?.[0];
  if (variantNode?.id) {
    const variantUpdates = { id: variantNode.id };
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
    variantUpdates.inventoryPolicy = sellWhenOutOfStock ? "CONTINUE" : "DENY";
    if (Object.keys(variantUpdates).length > 1) {
      const { id: _id, ...rest } = variantUpdates;
      await runGraphQLWithUserErrors(graphql, {
        query: `#graphql mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
        }`,
        variables: { productId: productIdGid, variants: [{ id: variantNode.id, ...rest }] },
      }, "productVariantsBulkUpdate");
    }
  }

  const vinDecoderMetafields = [];
  const validTitleStatuses = ["Clean", "Rebuilt", "Salvage", "Junk", "Flood"];
  if (titleStatus && validTitleStatuses.includes(String(titleStatus).trim())) {
    vinDecoderMetafields.push({ namespace: "vin_decoder", key: "title_status", type: "single_line_text_field", value: String(titleStatus).trim() });
  }
  if (mileage != null && mileage !== "") {
    const mileageNum = typeof mileage === "number" ? mileage : parseInt(String(mileage).replace(/\D/g, ""), 10);
    if (!Number.isNaN(mileageNum) && mileageNum >= 0) {
      vinDecoderMetafields.push({ namespace: "vin_decoder", key: "mileage", type: "number_integer", value: String(mileageNum) });
    }
  }
  if (vinDecoderMetafields.length > 0) {
    await runGraphQLWithUserErrors(graphql, {
      query: `#graphql mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { userErrors { field message } } }`,
      variables: {
        input: {
          id: productIdGid,
          metafields: vinDecoderMetafields.map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value })),
        },
      },
    }, "productUpdate");
  }
}
