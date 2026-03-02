/**
 * Product media service: get list, add media. Uses GraphQL wrapper only.
 */
import { runGraphQL, runGraphQLWithUserErrors } from "../lib/shopify-graphql.server.js";

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {string} productId
 * @returns {Promise<{ media: Array<unknown> }>}
 */
export async function getProductMedia(admin, productId) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const { data } = await runGraphQL(graphql, {
    query: `#graphql
    query productMedia($id: ID!) {
      product(id: $id) {
        id
        media(first: 50) {
          nodes { id alt mediaContentType status ... on MediaImage { image { url } } ... on Video { sources { url } previewImage { url } } }
        }
      }
    }`,
    variables: { id: productId },
  });
  const product = data?.product;
  if (!product) {
    const err = new Error("Product not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return { media: product.media?.nodes ?? [] };
}

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {string} productId
 * @param {Array<{ originalSource: string; mediaContentType: string; alt?: string }>} media
 * @returns {Promise<{ media: Array<unknown> }>}
 */
export async function addProductMedia(admin, productId, media) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const mediaInput = media.map((m) => ({
    originalSource: m.originalSource,
    mediaContentType: (m.mediaContentType || "IMAGE").toUpperCase() === "VIDEO" ? "VIDEO" : "IMAGE",
    alt: m.alt != null ? String(m.alt).slice(0, 512) : undefined,
  }));

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
}
