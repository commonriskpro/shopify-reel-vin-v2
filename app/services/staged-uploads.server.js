/**
 * Staged uploads service. IMAGE/VIDEO only; fileSize as string.
 * Throws ApiError(400) on userErrors.
 */
import { ApiError } from "../lib/api.server.js";
import { runGraphQLWithUserErrors } from "../lib/shopify-graphql.server.js";

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ files: Array<{ filename: string; mimeType: string; resource: "IMAGE" | "VIDEO"; fileSize: string }> }} options
 * @returns {Promise<{ stagedTargets: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }> }>}
 */
export async function createStagedUploads(admin, { files }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new ApiError(500, "Admin GraphQL required");
  const input = files.map((f) => ({
    filename: String(f.filename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 256),
    mimeType: String(f.mimeType || "image/jpeg"),
    resource: f.resource === "VIDEO" ? "VIDEO" : "IMAGE",
    fileSize: String(f.fileSize ?? "0"),
    httpMethod: "POST",
  }));

  try {
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
  } catch (e) {
    if (e?.code === "USER_ERRORS") {
      throw new ApiError(400, e?.message ?? "Staged upload failed", { code: "USER_ERRORS", details: e?.userErrors });
    }
    throw e;
  }
}
