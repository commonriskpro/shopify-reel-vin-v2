/**
 * Structured diagnostic logging for Shopify GraphQL. One JSON line per event.
 * Use in runGraphQL to capture request/response and fix "syntax error, unexpected end of file".
 * No secrets logged (no variables values, no tokens).
 */

const PREFIX = "[shopify-graphql]";

function ts() {
  return new Date().toISOString();
}

/**
 * Log a single diagnostic event as a JSON line (plus human-readable prefix for Vercel).
 * @param {string} event - REQUEST_SEND | RESPONSE_OK | RESPONSE_PARSE_FAIL | RESPONSE_HTTP_ERR | RESPONSE_GRAPHQL_ERR
 * @param {Record<string, unknown>} payload - keys and values to log (will be JSON.stringified)
 */
export function graphqlLog(event, payload) {
  const line = JSON.stringify({ ts: ts(), event, ...payload });
  if (event === "RESPONSE_GRAPHQL_ERR" || event === "RESPONSE_PARSE_FAIL" || event === "RESPONSE_HTTP_ERR") {
    console.error(`${PREFIX} ${line}`);
  } else {
    console.log(`${PREFIX} ${line}`);
  }
}
