/**
 * Shared VIN decode request handler used by both api.vins and api.decode-vin (shim).
 * Lives in a .server.js file so React Router / Vite exclude it from the client bundle.
 */
import { z } from "zod";
import { requireAdmin, jsonOk, jsonFail } from "../lib/api.server.js";
import { makeRequestId } from "../lib/api-envelope.js";
import { enforceRateLimit } from "../security.server.js";
import { decodeVin, normalizeVin, isValidVin } from "./vins.server.js";
import { logServerError } from "../http.server.js";

const querySchema = z.object({ vin: z.string().min(1, "vin is required") });

/**
 * Handle GET /api/vins?vin=XXX (and the /api/decode-vin shim).
 * Validates, rate-limits, decodes, and returns a unified JSON envelope response.
 * @param {Request} request
 * @param {{ scope?: string }} [opts]
 * @returns {Promise<Response>}
 */
export async function handleVinDecode(request, { scope = "api.vins" } = {}) {
  const requestId = makeRequestId(request);
  const { session } = await requireAdmin(request);

  const limited = enforceRateLimit(request, {
    scope,
    limit: 30,
    windowMs: 60_000,
    keyParts: [session?.shop ?? "unknown"],
  });
  if (!limited.ok) {
    return jsonFail(
      { message: "Too many VIN decode requests. Please try again shortly.", code: "RATE_LIMIT" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      { requestId }
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
    return jsonFail(
      { message: msg, code: "VALIDATION", details: { fieldErrors } },
      { status: 400 },
      { requestId }
    );
  }

  const vin = normalizeVin(parsed.data.vin);
  if (!isValidVin(vin)) {
    return jsonFail(
      {
        message: "Please provide a valid VIN (8–17 characters).",
        code: "INVALID_VIN",
        details: { fieldErrors: { vin: ["Please provide a valid VIN (8–17 characters)."] } },
      },
      { status: 400 },
      { requestId }
    );
  }

  try {
    const { decoded, raw } = await decodeVin(vin);
    return jsonOk({ decoded, raw }, {}, { requestId });
  } catch (e) {
    const message = e?.message ?? "Failed to decode VIN.";
    const isNotFound = message.includes("No decode results");
    logServerError(scope, e instanceof Error ? e : new Error(message), { requestId });
    return jsonFail(
      {
        message: isNotFound ? "No decode results found for this VIN." : message,
        code: isNotFound ? "NOT_FOUND" : "VPIC_ERROR",
        details: { retryable: !isNotFound },
      },
      { status: isNotFound ? 404 : 502 },
      { requestId }
    );
  }
}
