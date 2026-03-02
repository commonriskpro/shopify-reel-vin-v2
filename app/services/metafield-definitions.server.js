/**
 * Creates (or updates) Shopify product metafield definitions for vehicle inventory filters.
 *
 * Runs create-or-update (upsert):
 *   - First queries existing definitions under vin_decoder namespace.
 *   - Creates any that are missing.
 *   - Updates name/description on any that already exist but have a stale name.
 *
 * Never throws: returns results array; on fatal error appends { key: '_fatal', status: 'error', error }.
 */
import { syncMetafieldsLog, syncMetafieldsError } from "../lib/sync-metafields-debug.server.js";

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
    name: "Miles",
    description: "Odometer reading in miles (editable in product admin)",
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
    name: "Title",
    description: "Title status (Clean, Rebuilt, Salvage, Junk, Flood)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "vin",
    name: "VIN",
    description: "Vehicle Identification Number",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "decoded",
    name: "VIN decoded data",
    description: "Full VIN decode result (JSON)",
    type: "json",
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

/** Keys to pin so they appear in Shopify product admin (editable like standard fields). */
const PINNED_KEYS = ["title_status", "mileage"];

const PIN_MUTATION = `#graphql
  mutation metafieldDefinitionPin($identifier: MetafieldDefinitionIdentifierInput!) {
    metafieldDefinitionPin(identifier: $identifier) {
      pinnedDefinition { name key namespace }
      userErrors { field message }
    }
  }
`;

/** Safely parse GraphQL response (Response object or already-parsed). */
async function parseGraphQLRes(res) {
  if (!res) return null;
  try {
    if (typeof res.json === "function") return await res.json();
    if (typeof res === "object" && ("data" in res || "errors" in res)) return res;
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Upserts all vehicle metafield definitions.
 * Safe to run multiple times — existing definitions are updated (not re-created).
 * Never throws.
 *
 * @param {object} admin - admin object from authenticate.admin()
 * @returns {Promise<Array<{ key, name, status: 'created'|'updated'|'ok'|'error', id?, error? }>>}
 */
export async function createVehicleMetafieldDefinitions(admin) {
  const graphql = admin?.graphql;
  const results = [];

  syncMetafieldsLog("definitions.start", {});

  if (!graphql || typeof graphql !== "function") {
    syncMetafieldsError("definitions.no_graphql", new Error("Admin GraphQL required"), {});
    results.push({ key: "_init", name: "Init", status: "error", error: "Admin GraphQL required" });
    return results;
  }

  // 1. Fetch existing definitions so we know which to create vs update
  let existing = {};
  try {
    const listRes = await graphql(LIST_QUERY);
    const listJson = await parseGraphQLRes(listRes);
    const listData = listJson?.data ?? listJson;
    for (const node of listData?.metafieldDefinitions?.nodes ?? []) {
      if (node?.key) existing[node.key] = node;
    }
    syncMetafieldsLog("definitions.list", { count: Object.keys(existing).length });
  } catch (e) {
    syncMetafieldsError("definitions.list", e, {});
    // Non-fatal — fall back to create-only mode
  }

  try {
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
        const json = await parseGraphQLRes(res);
        const data = json?.data ?? json;
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
        const json = await parseGraphQLRes(res);
        const data = json?.data ?? json;
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

  // Pin Title and Miles so they appear in product admin and can be edited like standard fields
  for (const key of PINNED_KEYS) {
    try {
      const res = await graphql(PIN_MUTATION, {
        variables: {
          identifier: { ownerType: "PRODUCT", namespace: "vin_decoder", key },
        },
      });
      const json = await parseGraphQLRes(res);
      const data = json?.data ?? json;
      const errs = data?.metafieldDefinitionPin?.userErrors ?? [];
      const nonFatal = errs.every((e) => (e?.message ?? "").toLowerCase().includes("already") || (e?.message ?? "").toLowerCase().includes("pinned"));
      if (errs.length && !nonFatal) {
        results.push({ key, name: key, status: "error", error: errs.map((e) => e.message).join("; ") });
      }
    } catch (_) {
      // Non-fatal: definitions exist; pin may fail if already pinned or permissions
    }
  }

  syncMetafieldsLog("definitions.done", { total: results.length, errors: results.filter((r) => r.status === "error").length });
  } catch (fatal) {
    syncMetafieldsError("definitions.fatal", fatal instanceof Error ? fatal : new Error(String(fatal)), {});
    results.push({ key: "_fatal", name: "Fatal", status: "error", error: fatal?.message || String(fatal) });
  }

  return results;
}
