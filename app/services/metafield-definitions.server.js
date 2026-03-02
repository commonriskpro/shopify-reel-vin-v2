/**
 * Creates Shopify product metafield definitions for vehicle inventory filters.
 *
 * Why this is needed:
 *   Products created by the VIN decoder already store fields like year, make, model, etc.
 *   as metafields under the "vin_decoder" namespace. But Shopify's Search & Discovery app
 *   only surfaces metafields as collection filter options when a *definition* exists with
 *   storefront: "PUBLIC_READ" access. This service creates those definitions in one pass.
 *
 * After running, go to Shopify Admin → Apps → Search & Discovery → Filters → Add filter
 * and enable each vehicle filter. The collection page will then show the filter sidebar.
 */

export const VEHICLE_METAFIELD_DEFINITIONS = [
  {
    namespace: "vin_decoder",
    key: "year",
    name: "Year",
    description: "Vehicle model year (e.g. 2021)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "make",
    name: "Make",
    description: "Vehicle make / brand (e.g. Toyota)",
    type: "single_line_text_field",
  },
  {
    namespace: "vin_decoder",
    key: "model",
    name: "Model",
    description: "Vehicle model (e.g. Camry)",
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
    name: "Title Brand",
    description: "Vehicle title status (Clean, Salvage, Rebuilt, Junk, Flood)",
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

const CREATE_DEFINITION_MUTATION = `#graphql
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
        type { name }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Creates all vehicle metafield definitions.
 * Safe to run multiple times — already-existing definitions are reported but not re-created.
 *
 * @param {object} admin - admin object from authenticate.admin()
 * @returns {Promise<Array<{ key, name, status: 'created'|'exists'|'error', id?, error? }>>}
 */
export async function createVehicleMetafieldDefinitions(admin) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const results = [];

  for (const def of VEHICLE_METAFIELD_DEFINITIONS) {
    try {
      const res = await graphql(CREATE_DEFINITION_MUTATION, {
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

      // "TAKEN" or "already exists" = already set up; treat as success
      const alreadyExists = errors.some(
        (e) =>
          e.code === "TAKEN" ||
          (e.message || "").toLowerCase().includes("already") ||
          (e.message || "").toLowerCase().includes("taken")
      );

      if (created) {
        results.push({ key: def.key, name: def.name, status: "created", id: created.id });
      } else if (alreadyExists) {
        results.push({ key: def.key, name: def.name, status: "exists" });
      } else {
        results.push({
          key: def.key,
          name: def.name,
          status: "error",
          error: errors.map((e) => e.message).join("; ") || "Definition not created (no error details returned)",
        });
      }
    } catch (err) {
      results.push({
        key: def.key,
        name: def.name,
        status: "error",
        error: err?.message || err?.errors?.[0]?.message || String(err),
      });
    }
  }

  return results;
}
