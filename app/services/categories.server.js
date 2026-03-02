/**
 * Category service: taxonomy categories for vehicles. Uses GraphQL wrapper only.
 */
import { runGraphQL } from "../lib/shopify-graphql.server.js";

/**
 * @param {import("@shopify/shopify-api").AdminApiContext} admin
 * @returns {Promise<{ categories: Array<{ id: string; name: string; fullName?: string }>; defaultCategoryId: string }>}
 */
export async function getCategoriesForVehicles(admin) {
  const graphql = admin?.graphql;
  if (!graphql) throw new Error("Admin GraphQL required");
  const run = (q, v) => runGraphQL(graphql, { query: q, variables: v });
  let nodes = [];
  try {
    const res1 = await run(
      `#graphql
      query getTaxonomy { taxonomy { categories(first: 50, search: "Vehicles") { nodes { id name fullName } } } }`
    );
    nodes = res1?.data?.taxonomy?.categories?.nodes ?? [];
  } catch (_) {}
  if (nodes.length === 0) {
    try {
      const res2 = await run(
        `#graphql
        query getTaxonomyTop { taxonomy { categories(first: 100) { nodes { id name fullName } } } }`
      );
      nodes = res2?.data?.taxonomy?.categories?.nodes ?? [];
    } catch (_) {}
  }
  const categories = nodes.map((n) => ({ id: n.id, name: n.name, fullName: n.fullName || n.name }));
  const vehicles = nodes.find((n) => (n.name && n.name.toLowerCase() === "vehicles") || (n.fullName && n.fullName.toLowerCase().includes("vehicle")));
  const defaultCategoryId = vehicles?.id ?? "";
  return { categories, defaultCategoryId };
}
