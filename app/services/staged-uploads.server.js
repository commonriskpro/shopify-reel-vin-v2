/**
 * Staged uploads service. Uses GraphQL wrapper only.
 */
import { runGraphQLWithUserErrors } from "../lib/shopify-graphql.server.js";

function resourceByMime(mime) {
  if (!mime) return "PRODUCT_IMAGE";
  const m = String(mime).toLowerCase();
  if (m.startsWith("video/")) return "PRODUCT_VIDEO";
  if (m.includes("model/gltf") || m.includes("model/glb")) return "MODEL_3D";
  return "PRODUCT_IMAGE";
}

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ files: Array<{ filename: string; mimeType: string; fileSize?: number }> }} options
 * @returns {Promise<{ stagedTargets: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }> }>}
 */
export async function createStagedUploads(admin, { files }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const input = files.map((f) => {
    const resource = resourceByMime(f.mimeType);
    const entry = {
      filename: String(f.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 256),
      mimeType: String(f.mimeType || "image/jpeg"),
      resource,
      httpMethod: "POST",
    };
    if (resource === "PRODUCT_VIDEO" || resource === "MODEL_3D") {
      const size = Number(f.fileSize);
      if (Number.isInteger(size) && size > 0) entry.fileSize = size;
    }
    return entry;
  });

  const { data } = await runGraphQLWithUserErrors(graphql, {
    query: `#graphql
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    variables: { input },
  }, "stagedUploadsCreate");

  const stagedTargets = data?.stagedUploadsCreate?.stagedTargets ?? [];
  return { stagedTargets };
}
