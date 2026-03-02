/**
 * Metafields service: VIN decoder definitions, show reels on homepage. Uses GraphQL wrapper only.
 */
import { runGraphQL, runGraphQLWithUserErrors } from "../lib/shopify-graphql.server.js";

const METAFIELD_DEFINITIONS = [
  { name: "VIN", namespace: "vin_decoder", key: "vin", type: "single_line_text_field", description: "Vehicle Identification Number (from VIN Decoder app).", ownerType: "PRODUCT" },
  { name: "VIN decoded data", namespace: "vin_decoder", key: "decoded", type: "json", description: "Full VIN decode result (from VIN Decoder app).", ownerType: "PRODUCT" },
  { name: "Vehicle year", namespace: "vin_decoder", key: "year", type: "single_line_text_field", description: "Vehicle year from VIN decode.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Vehicle make", namespace: "vin_decoder", key: "make", type: "single_line_text_field", description: "Vehicle make from VIN decode.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Vehicle model", namespace: "vin_decoder", key: "model", type: "single_line_text_field", description: "Vehicle model from VIN decode.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Mileage", namespace: "vin_decoder", key: "mileage", type: "number_integer", description: "Vehicle mileage.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Drivetrain", namespace: "vin_decoder", key: "drivetrain", type: "single_line_text_field", description: "Drive type from VIN decode.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Fuel type", namespace: "vin_decoder", key: "fuel_type", type: "single_line_text_field", description: "Fuel type from VIN decode.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Title brand", namespace: "vin_decoder", key: "title_status", type: "single_line_text_field", description: "Vehicle title type: Salvage, Clean, Rebuilt, Junk.", ownerType: "PRODUCT", useAsCollectionCondition: true, validations: [{ name: "choices", value: '["Salvage","Clean","Rebuilt","Junk"]' }] },
  { name: "Transmission", namespace: "vin_decoder", key: "transmission", type: "single_line_text_field", description: "Transmission from VIN decode.", ownerType: "PRODUCT", useAsCollectionCondition: true },
  { name: "Show reels on store homepage", namespace: "vin_decoder", key: "show_reels_on_homepage", type: "boolean", description: "When true, Shoppable Reels section is shown on store homepage.", ownerType: "SHOP", access: { storefront: "PUBLIC_READ" } },
];

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @returns {Promise<{ ok: boolean; errors?: string[] }>}
 */
export async function ensureVinDecoderMetafieldDefinitions(admin) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const errors = [];
  for (const definition of METAFIELD_DEFINITIONS) {
    try {
      const { data } = await runGraphQL(graphql, {
        query: `#graphql
        mutation CreateVinDecoderMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id name }
            userErrors { field message code }
          }
        }`,
        variables: { definition },
      });
      const payload = data?.metafieldDefinitionCreate;
      if (payload?.userErrors?.length) {
        const alreadyExists = payload.userErrors.some((e) => e.code === "TAKEN" || (e.message && e.message.toLowerCase().includes("already exists")));
        if (!alreadyExists) errors.push(...payload.userErrors.map((e) => e.message));
      }
    } catch (_) {
      errors.push("Metafield definition create failed");
    }
  }

  try {
    const { data } = await runGraphQL(graphql, {
      query: `#graphql
      mutation PinTitleMetafield($identifier: MetafieldDefinitionIdentifierInput!) {
        metafieldDefinitionPin(identifier: $identifier) {
          pinnedDefinition { name key namespace pinnedPosition }
          userErrors { field message }
        }
      }`,
      variables: { identifier: { ownerType: "PRODUCT", namespace: "vin_decoder", key: "title_status" } },
    });
    const pinPayload = data?.metafieldDefinitionPin;
    if (pinPayload?.userErrors?.length) {
      const nonFatal = pinPayload.userErrors.every((e) => e.message && (e.message.toLowerCase().includes("already") || e.message.toLowerCase().includes("pinned")));
      if (!nonFatal) errors.push(...pinPayload.userErrors.map((e) => e.message));
    }
  } catch (_) {
    errors.push("Pin metafield failed");
  }

  return { ok: errors.length === 0, errors: errors.length ? errors : undefined };
}

const SHOP_REELS_NAMESPACE = "vin_decoder";
const SHOP_REELS_KEY = "show_reels_on_homepage";

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @returns {Promise<boolean>}
 */
export async function getShowReelsOnHomepage(admin) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const { data } = await runGraphQL(graphql, {
    query: `#graphql
    query GetShowReelsOnHomepage {
      shop { metafield(namespace: "${SHOP_REELS_NAMESPACE}", key: "${SHOP_REELS_KEY}") { value } }
    }`,
  });
  const value = data?.shop?.metafield?.value;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return true;
}

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {boolean} show
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
export async function setShowReelsOnHomepage(admin, show) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const { data } = await runGraphQL(graphql, { query: `#graphql query { shop { id } }` });
  const shopId = data?.shop?.id;
  if (!shopId) return { ok: false, error: "Could not get shop id" };

  try {
    await runGraphQLWithUserErrors(graphql, {
      query: `#graphql
      mutation SetShowReelsOnHomepage($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id value }
          userErrors { field message }
        }
      }`,
      variables: {
        metafields: [{ namespace: SHOP_REELS_NAMESPACE, key: SHOP_REELS_KEY, type: "boolean", value: String(show), ownerId: shopId }],
      },
    }, "metafieldsSet");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message ?? "Failed to set metafield" };
  }
}
