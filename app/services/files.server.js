/**
 * Shop files service for media picker. Uses GraphQL wrapper only.
 */
import { runGraphQL } from "../lib/shopify-graphql.server.js";

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ first: number; after?: string | null }} options
 * @returns {Promise<{ nodes: Array<{ id: string; cursor: string; alt?: string; url: string; mediaContentType: string; previewUrl?: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } }>}
 */
export async function listShopFiles(admin, { first, after }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const { data } = await runGraphQL(graphql, {
    query: `#graphql
    query shopFiles($first: Int!, $after: String) {
      files(first: $first, after: $after) {
        edges { cursor node { id alt ... on MediaImage { image { url } mediaContentType } ... on Video { sources { url } previewImage { url } mediaContentType } ... on GenericFile { url mimeType } } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    variables: { first, after: after || undefined },
  });
  const files = data?.files;
  const edges = files?.edges ?? [];
  const nodes = edges
    .map(({ node, cursor }) => {
      let fileUrl = null;
      let mediaContentType = "IMAGE";
      if (node?.image?.url) {
        fileUrl = node.image.url;
      } else if (node?.sources?.[0]?.url) {
        fileUrl = node.sources[0].url;
        mediaContentType = "VIDEO";
      } else if (node?.previewImage?.url) {
        fileUrl = node.previewImage.url;
        mediaContentType = "VIDEO";
      } else if (node?.url) {
        fileUrl = node.url;
        mediaContentType = (node?.mimeType || "").startsWith("video/") ? "VIDEO" : "IMAGE";
      }
      const previewUrl = node?.image?.url || node?.previewImage?.url || node?.sources?.[0]?.url || node?.url;
      return { id: node?.id, cursor, alt: node?.alt, url: fileUrl, mediaContentType, previewUrl };
    })
    .filter((n) => n.url);
  return {
    nodes,
    pageInfo: files?.pageInfo ?? { hasNextPage: false, endCursor: null },
  };
}
