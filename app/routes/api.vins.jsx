/**
 * GET /api/vins?vin=XXX — Decode VIN (resource-only). Zod at edge, fixed envelope.
 */
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { enforceRateLimit } from "../security.server.js";
import { decodeVin, normalizeVin, isValidVin } from "../services/vins.server.js";
import { logServerError } from "../http.server.js";
import { makeRequestId, ok, err } from "../lib/api-envelope.js";

const querySchema = z.object({ vin: z.string().min(1, "vin is required") });

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
    scope: "api.vins",
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
  const parsed = querySchema.safeParse({ vin: url.searchParams.get("vin") ?? "" });
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => e.message).join("; ");
    const fieldErrors = {};
    for (const issue of parsed.error.errors) {
      const path = issue.path.filter(Boolean).join(".") || "vin";
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    return Response.json(
      err({ code: "VALIDATION", message: msg, source: "VALIDATION", fieldErrors }, { requestId }),
      { status: 400 }
    );
  }

  const vin = normalizeVin(parsed.data.vin);
  if (!isValidVin(vin)) {
    return Response.json(
      err({
        code: "INVALID_VIN",
        message: "Please provide a valid VIN (8–17 characters).",
        source: "VALIDATION",
        fieldErrors: { vin: ["Please provide a valid VIN (8–17 characters)."] },
      }, { requestId }),
      { status: 400 }
    );
  }

  try {
    const { decoded, raw } = await decodeVin(vin);
    return Response.json(ok({ decoded, raw }, { requestId }));
  } catch (e) {
    const message = e?.message ?? "Failed to decode VIN.";
    const isNotFound = message.includes("No decode results");
    logServerError("api.vins", e instanceof Error ? e : new Error(message), { requestId });
    return Response.json(
      err({
        code: isNotFound ? "NOT_FOUND" : "VPIC_ERROR",
        message: isNotFound ? "No decode results found for this VIN." : message,
        source: isNotFound ? "VPIC" : "VPIC",
        retryable: !isNotFound,
      }, { requestId }),
      { status: isNotFound ? 404 : 502 }
    );
  }
}

export default function ApiVins() {
  return null;
}
