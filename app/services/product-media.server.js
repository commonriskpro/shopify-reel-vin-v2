/**
 * Product media service: get list, attach media. Uses GraphQL wrapper only.
 * Throws ApiError on userErrors / not found.
 */
import { ApiError } from "../lib/api.server.js";
import { runGraphQL, runGraphQLWithUserErrors } from "../lib/shopify-graphql.server.js";

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {string} productId
 * @returns {Promise<{ media: Array<unknown> }>}
 */
export async function getProductMedia(admin, productId) {
  const graphql = admin?.graphql;
  if (!graphql) throw new ApiError(500, "Admin GraphQL required");
  const { data } = await runGraphQL(graphql, {
    query: `#graphql
    query productMedia($id: ID!) {
      product(id: $id) {
        id
        media(first: 50) {
          nodes { id alt mediaContentType status ... on MediaImage { image { url } } ... on Video { sources { url } preview { image { url } } } }
        }
      }
    }`,
    variables: { id: productId },
  });
  const product = data?.product;
  if (!product) {
    throw new ApiError(404, "Product not found", { code: "NOT_FOUND" });
  }
  return { media: product.media?.nodes ?? [] };
}

/**
 * Attach media to a product (productCreateMedia). Throws ApiError(400) on userErrors.
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ productId: string; media: Array<{ originalSource: string; mediaContentType: string; alt?: string }> }} options
 * @returns {Promise<{ media: Array<unknown> }>}
 */
export async function attachMediaToProduct(admin, { productId, media }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new ApiError(500, "Admin GraphQL required");
  const mediaInput = media.map((m) => ({
    originalSource: m.originalSource,
    mediaContentType: (m.mediaContentType || "IMAGE").toUpperCase() === "VIDEO" ? "VIDEO" : "IMAGE",
    alt: m.alt != null ? String(m.alt).slice(0, 512) : undefined,
  }));

  try {
    const { data } = await runGraphQLWithUserErrors(
      graphql,
      {
        query: `#graphql
        mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { id alt mediaContentType status ... on MediaImage { image { url } } ... on Video { sources { url } previewImage { url } } }
            mediaUserErrors { field message code }
          }
        }`,
        variables: { productId, media: mediaInput },
      },
      "productCreateMedia",
      "mediaUserErrors"
    );
    const list = data?.productCreateMedia?.media ?? [];
    return { media: list };
  } catch (e) {
    if (e?.code === "USER_ERRORS") {
      throw new ApiError(400, e?.message ?? "Failed to add media", { code: "USER_ERRORS", details: e?.userErrors });
    }
    throw e;
  }
}

/**
 * Reorder product media using productReorderMedia mutation.
 * Polls the returned Job until done (or timeout). Requires write_products.
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ productId: string; mediaIds: string[] }} options - ordered array of media GIDs
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
export async function reorderProductMedia(admin, { productId, mediaIds }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new ApiError(500, "Admin GraphQL required");
  if (!mediaIds?.length) return { ok: true };

  const moves = mediaIds.map((id, newPosition) => ({
    id,
    newPosition: String(newPosition),
  }));

  const { data } = await runGraphQL(graphql, {
    query: `#graphql
    mutation productReorderMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        mediaUserErrors { message code }
        job { id }
      }
    }`,
    variables: { id: productId, moves },
  });

  const payload = data?.productReorderMedia;
  const userErrors = payload?.mediaUserErrors ?? [];
  if (userErrors.length > 0) {
    const msg = userErrors.map((e) => e?.message ?? "").filter(Boolean).join("; ") || "Reorder failed";
    throw new ApiError(400, msg, { code: "USER_ERRORS", details: userErrors });
  }

  const jobId = payload?.job?.id;
  if (!jobId) return { ok: true };

  // Poll job until done (max ~5s)
  const maxAttempts = 10;
  const intervalMs = 500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const { data: jobData } = await runGraphQL(graphql, {
      query: `#graphql query jobStatus($id: ID!) { job(id: $id) { id done } }`,
      variables: { id: jobId },
    });
    if (jobData?.job?.done) return { ok: true };
  }

  return { ok: true };
}

/**
 * Delete media from a product (productDeleteMedia). Throws ApiError on userErrors.
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ productId: string; mediaIds: string[] }} options - product GID and media GIDs to delete
 * @returns {Promise<{ deletedMediaIds: string[] }>}
 */
export async function deleteProductMedia(admin, { productId, mediaIds }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new ApiError(500, "Admin GraphQL required");
  if (!mediaIds?.length) return { deletedMediaIds: [] };

  const { data } = await runGraphQLWithUserErrors(
    graphql,
    {
      query: `#graphql
      mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          mediaUserErrors { field message code }
        }
      }`,
      variables: { productId, mediaIds },
    },
    "productDeleteMedia",
    "mediaUserErrors"
  );
  const payload = data?.productDeleteMedia;
  const deleted = payload?.deletedMediaIds ?? [];
  return { deletedMediaIds: deleted };
}

/**
 * @deprecated Use attachMediaToProduct. Kept for compatibility.
 */
export async function addProductMedia(admin, productId, media) {
  return attachMediaToProduct(admin, { productId, media });
}
