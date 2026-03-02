/**
 * Central Shopify GraphQL wrapper. All Shopify GraphQL calls must go through this.
 * Normalizes HTTP errors, top-level errors, and userErrors. No secrets in logs.
 * @see docs/DMS-STEP1-SPEC.md §10
 */

import { logServerError } from "../http.server.js";

/** @typedef {"VALIDATION"|"SHOPIFY"|"VPIC"|"DB"|"INTERNAL"} ErrorSource */

/**
 * Normalized error thrown by runGraphQL. Services can catch and map to ApiErr.
 * @typedef {{ code: string; message: string; source: ErrorSource; retryable?: boolean; details?: unknown; userErrors?: Array<{ field?: string[]; message: string }> }} GraphQLError
 */

/**
 * @param {import("@shopify/shopify-api").AdminApiContext["graphql"]} graphql - admin.graphql
 * @param {{ query: string; variables?: Record<string, unknown>; operationName?: string }} options
 * @returns {Promise<{ data: unknown }>}
 * @throws {GraphQLError}
 */
export async function runGraphQL(graphql, { query, variables = {}, operationName }) {
  // Defensive guard — if query is empty the Shopify API returns "syntax error, unexpected end of file"
  const queryStr = typeof query === "string" ? query.trim() : "";
  if (!queryStr) {
    console.error("[shopify-graphql] EMPTY_QUERY detected — query string is empty or undefined", { operationName });
    throw {
      code: "EMPTY_QUERY",
      message: "GraphQL query string is empty (internal error)",
      source: "INTERNAL",
      retryable: false,
    };
  }

  // Log query fingerprint (first 120 chars, no secrets) and variable key count for debugging
  const querySnippet = queryStr.slice(0, 120).replace(/\s+/g, " ");
  const varKeys = Object.keys(variables || {});
  console.log(`[shopify-graphql] SEND op=${operationName ?? "?"} varKeys=[${varKeys.join(",")}] queryLen=${queryStr.length} query="${querySnippet}"`);

  const res = await graphql(queryStr, { variables, operationName });
  const status = res?.status ?? (res.ok === false ? 500 : 200);
  let rawText = "";
  let json;
  try {
    // Use .text() + JSON.parse so we can log the raw body on failure.
    // Fall back to .json() directly if .text() is not available (e.g. test mocks).
    if (typeof res.text === "function") {
      rawText = await res.text();
      json = JSON.parse(rawText);
    } else {
      json = await res.json();
    }
  } catch (e) {
    // Log first 300 chars of raw body so we can see what Shopify actually returned
    console.error("[shopify-graphql] PARSE_FAIL status=" + status + " raw=" + rawText.slice(0, 300));
    logServerError("shopify-graphql.parse", e instanceof Error ? e : new Error(String(e)), { requestId: "[no-request]", status });
    throw {
      code: "GRAPHQL_PARSE",
      message: "Failed to parse GraphQL response (status " + status + ")",
      source: "SHOPIFY",
      retryable: true,
      details: { rawPreview: rawText.slice(0, 200) },
    };
  }

  if (status >= 400) {
    const message = json?.errors?.[0]?.message ?? `HTTP ${status}`;
    logServerError("shopify-graphql.http", new Error(message), { status, requestId: "[no-request]" });
    throw {
      code: "GRAPHQL_HTTP",
      message,
      source: "SHOPIFY",
      retryable: status === 429 || status >= 500,
      details: { status },
    };
  }

  const topLevelErrors = json?.errors;
  if (Array.isArray(topLevelErrors) && topLevelErrors.length > 0) {
    const first = topLevelErrors[0];
    const message = first?.message ?? "GraphQL error";
    // Log the full error + query snippet to diagnose "syntax error, unexpected end of file"
    console.error(`[shopify-graphql] TOP_LEVEL_ERROR op=${operationName ?? "?"} msg="${message}" extensions=${JSON.stringify(first?.extensions)} querySnippet="${querySnippet}"`);
    logServerError("shopify-graphql.errors", new Error(message), { requestId: "[no-request]", operationName });
    throw {
      code: first?.extensions?.code ?? "GRAPHQL_ERROR",
      message,
      source: "SHOPIFY",
      retryable: false,
      details: { errors: topLevelErrors },
    };
  }

  return { data: json?.data ?? null };
}

/**
 * Run a GraphQL operation and extract userErrors from a known mutation/query result path.
 * Use when the operation returns { data: { operationName: { userErrors, ... } } }.
 * @param {import("@shopify/shopify-api").AdminApiContext["graphql"]} graphql
 * @param {{ query: string; variables?: Record<string, unknown>; operationName?: string }} options
 * @param {string} resultPath - e.g. "productCreate", "stagedUploadsCreate"
 * @param {string} [userErrorsKey] - e.g. "userErrors" or "mediaUserErrors"
 * @returns {Promise<{ data: unknown }>} data is the full GraphQL data (so data[resultPath] has the mutation result)
 * @throws {GraphQLError} if userErrors present and non-empty (so caller can map to 400)
 */
export async function runGraphQLWithUserErrors(graphql, options, resultPath, userErrorsKey = "userErrors") {
  const { data } = await runGraphQL(graphql, options);
  const payload = data?.[resultPath];
  const userErrors = payload?.[userErrorsKey] ?? [];
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    throw {
      code: "USER_ERRORS",
      message: userErrors.map((e) => e.message).join("; "),
      source: "SHOPIFY",
      retryable: false,
      userErrors,
    };
  }
  return { data };
}
