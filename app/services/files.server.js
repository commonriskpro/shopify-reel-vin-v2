/**
 * Shop files service for media picker. Lists Shopify Files (images/videos/generic).
 * Returns normalized items for "Select existing" modal.
 */
import { runGraphQL } from "../lib/shopify-graphql.server.js";

/**
 * @typedef {{ id: string; type: "IMAGE"|"VIDEO"|"FILE"; alt?: string; createdAt?: string; previewUrl?: string; url: string }} FileItem
 */

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @param {{ first: number; after?: string | null }} options
 * @returns {Promise<{ items: FileItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }>}
 */
export async function listFiles(admin, { first, after }) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const { data } = await runGraphQL(graphql, {
    query: `#graphql
    query shopFiles($first: Int!, $after: String) {
      files(first: $first, after: $after) {
        edges { cursor node { id alt ... on MediaImage { image { url } mediaContentType } ... on Video { sources { url } preview { image { url } } mediaContentType } ... on GenericFile { url mimeType } } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    variables: { first, after: after || undefined },
  });
  const files = data?.files;
  const edges = files?.edges ?? [];
  const items = edges
    .map(({ node }) => {
      let url = null;
      let type = "FILE";
      if (node?.image?.url) {
        url = node.image.url;
        type = "IMAGE";
      } else if (node?.sources?.[0]?.url) {
        url = node.sources[0].url;
        type = "VIDEO";
      } else if (node?.preview?.image?.url) {
        url = node.preview.image.url;
        type = "VIDEO";
      } else if (node?.url) {
        url = node.url;
        type = (node?.mimeType || "").startsWith("video/") ? "VIDEO" : "IMAGE";
      }
      const previewUrl = node?.image?.url || node?.preview?.image?.url || node?.sources?.[0]?.url || node?.url;
      if (!url) return null;
      return {
        id: node?.id,
        type: /** @type {FileItem["type"]} */ (type),
        alt: node?.alt ?? undefined,
        createdAt: undefined,
        previewUrl: previewUrl ?? undefined,
        url,
      };
    })
    .filter(Boolean);
  return {
    items,
    pageInfo: files?.pageInfo ?? { hasNextPage: false, endCursor: null },
  };
}

/** @deprecated Use listFiles. Kept for compatibility. */
export async function listShopFiles(admin, options) {
  const { items, pageInfo } = await listFiles(admin, options);
  const nodes = items.map((it) => ({
    id: it.id,
    alt: it.alt,
    url: it.url,
    mediaContentType: it.type,
    previewUrl: it.previewUrl,
  }));
  return { nodes, pageInfo };
}
