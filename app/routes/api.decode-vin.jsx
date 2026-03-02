/**
 * DEPRECATED: use /api/vins. Thin shim: GET /api/decode-vin?vin=XXX → same as GET /api/vins?vin=XXX. Returns fixed envelope.
 */
import { authenticate } from "../shopify.server";
import { enforceRateLimit } from "../security.server.js";
import { decodeVin, normalizeVin, isValidVin } from "../services/vins.server.js";
import { logServerError } from "../http.server.js";
import { makeRequestId, ok, err } from "../lib/api-envelope.js";

export async function loader({ request }) {
  const requestId = makeRequestId(request);
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;
  } catch (e) {
    return Response.json(
      err({ code: "UNAUTHORIZED", message: "Authentication required", source: "INTERNAL" }, { requestId }),
      { status: 401 }
    );
  }

  const limited = enforceRateLimit(request, {
    scope: "api.decode-vin",
    limit: 30,
    windowMs: 60_000,
    keyParts: [session?.shop ?? "unknown"],
  });
  if (!limited.ok) {
    return Response.json(
      err({ code: "RATE_LIMIT", message: "Too many VIN decode requests. Please try again shortly.", source: "INTERNAL", retryable: true }, { requestId }),
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const url = new URL(request.url);
  const vin = normalizeVin(url.searchParams.get("vin"));
  if (!isValidVin(vin)) {
    return Response.json(
      err({ code: "INVALID_VIN", message: "Please provide a valid VIN (8–17 characters).", source: "VALIDATION" }, { requestId }),
      { status: 400 }
    );
  }

  try {
    const { decoded, raw } = await decodeVin(vin);
    return Response.json(ok({ decoded, raw }, { requestId }));
  } catch (e) {
    const message = e?.message ?? "Failed to decode VIN.";
    const isNotFound = message.includes("No decode results");
    logServerError("api.decode-vin", e instanceof Error ? e : new Error(message), { requestId });
    return Response.json(
      err({
        code: isNotFound ? "NOT_FOUND" : "VPIC_ERROR",
        message: isNotFound ? "No decode results found for this VIN." : message,
        source: "VPIC",
        retryable: !isNotFound,
      }, { requestId }),
      { status: isNotFound ? 404 : 502 }
    );
  }
}

export default function ApiDecodeVin() {
  return null;
}
