/**
 * Creates (or updates) Shopify product metafield definitions for vehicle inventory filters.
 *
 * Runs create-or-update (upsert):
 *   - First queries existing definitions under vin_decoder namespace.
 *   - Creates any that are missing.
 *   - Updates name/description on any that already exist but have a stale name.
 */

export const VEHICLE_METAFIELD_DEFINITIONS = [
  {
    namespace: "vin_decoder",
    key: "year",
    name: "Year",
    description: "Model year (e.g. 2021)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "make",
    name: "Make",
    description: "Brand / manufacturer (e.g. Toyota)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "model",
    name: "Model",
    description: "Model name (e.g. Camry)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "mileage",
    name: "Mileage",
    description: "Odometer reading in miles",
    type: "number_integer",
  },
  {
    namespace: "vin_decoder",
    key: "drivetrain",
    name: "Drivetrain",
    description: "Drive type (2WD, 4WD, AWD, FWD, RWD)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "fuel_type",
    name: "Fuel Type",
    description: "Primary fuel type (Gasoline, Electric, Diesel, Hybrid)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "transmission",
    name: "Transmission",
    description: "Transmission style (Automatic, Manual)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "title_status",
    name: "Brand",
    description: "Title brand / status (Clean, Salvage, Rebuilt, Junk, Flood)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "vin",
    name: "VIN",
    description: "Vehicle Identification Number",
    type: "single_line_text_field",
  },
];

const CREATE_MUTATION = `#graphql
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id name namespace key }
      userErrors { field message code }
    }
  }
`;

const UPDATE_MUTATION = `#graphql
  mutation metafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition { id name namespace key }
      userErrors { field message code }
    }
  }
`;
// MetafieldDefinitionUpdateInput identifies by namespace+key+ownerType, NOT id

const LIST_QUERY = `#graphql
  query listVinDecoderDefinitions {
    metafieldDefinitions(namespace: "vin_decoder", ownerType: PRODUCT, first: 30) {
      nodes { id key name namespace }
    }
  }
`;

/**
 * Upserts all vehicle metafield definitions.
 * Safe to run multiple times — existing definitions are updated (not re-created).
 *
 * @param {object} admin - admin object from authenticate.admin()
 * @returns {Promise<Array<{ key, name, status: 'created'|'updated'|'ok'|'error', id?, error? }>>}
 */
export async function createVehicleMetafieldDefinitions(admin) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");

  // 1. Fetch existing definitions so we know which to create vs update
  let existing = {};
  try {
    const listRes = await graphql(LIST_QUERY);
    const { data: listData } = await listRes.json();
    for (const node of listData?.metafieldDefinitions?.nodes ?? []) {
      existing[node.key] = node; // { id, key, name, namespace }
    }
  } catch (_) {
    // Non-fatal — fall back to create-only mode
  }

  const results = [];

  for (const def of VEHICLE_METAFIELD_DEFINITIONS) {
    const existingDef = existing[def.key];

    if (existingDef) {
      // Already exists — update name/description if needed
      if (existingDef.name === def.name) {
        results.push({ key: def.key, name: def.name, status: "ok", id: existingDef.id });
        continue;
      }
      try {
        const res = await graphql(UPDATE_MUTATION, {
          variables: {
            definition: {
              namespace: def.namespace,
              key: def.key,
              ownerType: "PRODUCT",
              name: def.name,
              description: def.description,
            },
          },
        });
        const { data } = await res.json();
        const updated = data?.metafieldDefinitionUpdate?.updatedDefinition;
        const errors = data?.metafieldDefinitionUpdate?.userErrors ?? [];
        if (updated) {
          results.push({ key: def.key, name: def.name, status: "updated", id: updated.id });
        } else {
          results.push({
            key: def.key,
            name: def.name,
            status: "error",
            error: errors.map((e) => e.message).join("; ") || "Update failed",
          });
        }
      } catch (err) {
        results.push({ key: def.key, name: def.name, status: "error", error: err?.message || String(err) });
      }
    } else {
      // Doesn't exist — create it
      try {
        const res = await graphql(CREATE_MUTATION, {
          variables: {
            definition: {
              namespace: def.namespace,
              key: def.key,
              name: def.name,
              description: def.description,
              type: def.type,
              ownerType: "PRODUCT",
              access: {
                storefront: "PUBLIC_READ",
              },
            },
          },
        });
        const { data } = await res.json();
        const created = data?.metafieldDefinitionCreate?.createdDefinition;
        const errors = data?.metafieldDefinitionCreate?.userErrors ?? [];
        const alreadyExists = errors.some(
          (e) => e.code === "TAKEN" || (e.message || "").toLowerCase().includes("already")
        );
        if (created) {
          results.push({ key: def.key, name: def.name, status: "created", id: created.id });
        } else if (alreadyExists) {
          results.push({ key: def.key, name: def.name, status: "ok" });
        } else {
          results.push({
            key: def.key,
            name: def.name,
            status: "error",
            error: errors.map((e) => e.message).join("; ") || "Unknown error",
          });
        }
      } catch (err) {
        results.push({ key: def.key, name: def.name, status: "error", error: err?.message || String(err) });
      }
    }
  }

  return results;
}
