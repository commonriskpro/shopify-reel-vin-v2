import { describe, it, expect, vi } from "vitest";
import { runGraphQL, runGraphQLWithUserErrors } from "../app/lib/shopify-graphql.server.js";

describe("runGraphQL", () => {
  it("returns data on success", async () => {
    const graphql = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { shop: { id: "gid://shopify/Shop/1" } } }),
    });
    const result = await runGraphQL(graphql, { query: "query { shop { id } }" });
    expect(result.data).toEqual({ shop: { id: "gid://shopify/Shop/1" } });
  });

  it("throws on top-level GraphQL errors", async () => {
    const graphql = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ errors: [{ message: "Something wrong" }] }),
    });
    await expect(runGraphQL(graphql, { query: "query { x }" })).rejects.toMatchObject({
      code: "GRAPHQL_ERROR",
      message: "Something wrong",
      source: "SHOPIFY",
    });
  });

  it("throws on HTTP 4xx/5xx", async () => {
    const graphql = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({}),
    });
    await expect(runGraphQL(graphql, { query: "query { x }" })).rejects.toMatchObject({
      source: "SHOPIFY",
      retryable: true,
    });
  });
});

describe("runGraphQLWithUserErrors", () => {
  it("returns data when no userErrors", async () => {
    const graphql = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            productCreate: {
              product: { id: "gid://shopify/Product/1" },
              userErrors: [],
            },
          },
        }),
    });
    const result = await runGraphQLWithUserErrors(
      graphql,
      { query: "mutation { productCreate { product { id } userErrors { message } } }", variables: {} },
      "productCreate"
    );
    expect(result.data?.productCreate?.product?.id).toBe("gid://shopify/Product/1");
  });

  it("throws when userErrors present", async () => {
    const graphql = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            productCreate: {
              product: null,
              userErrors: [{ field: ["title"], message: "Title is invalid" }],
            },
          },
        }),
    });
    await expect(
      runGraphQLWithUserErrors(
        graphql,
        { query: "mutation { productCreate { product { id } userErrors { field message } } }", variables: {} },
        "productCreate"
      )
    ).rejects.toMatchObject({
      code: "USER_ERRORS",
      source: "SHOPIFY",
      userErrors: [{ message: "Title is invalid" }],
    });
  });
});
