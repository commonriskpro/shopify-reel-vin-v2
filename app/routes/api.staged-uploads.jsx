/**
 * POST /api/staged-uploads — Create staged upload targets. Zod at edge, fixed envelope.
 */
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { createStagedUploads } from "../services/staged-uploads.server.js";
import { logServerError } from "../http.server.js";
import { makeRequestId, ok, err, zodErrorToFieldErrors, rejectIfBodyTooLarge } from "../lib/api-envelope.js";

const bodySchema = z.object({
  files: z.array(z.object({
    filename: z.string(),
    mimeType: z.string(),
    fileSize: z.number().optional(),
  })).min(1, "files array required"),
});

export async function action({ request }) {
  const requestId = makeRequestId(request);
  if (request.method !== "POST") {
    return Response.json(
      err({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed", source: "VALIDATION" }, { requestId }),
      { status: 405 }
    );
  }
  const tooLarge = rejectIfBodyTooLarge(request);
  if (tooLarge) return tooLarge;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json(
      err({ code: "INVALID_JSON", message: "Invalid JSON", source: "VALIDATION" }, { requestId }),
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      err({
        code: "VALIDATION",
        message: parsed.error.errors.map((e) => e.message).join("; "),
        source: "VALIDATION",
        fieldErrors: zodErrorToFieldErrors(parsed.error),
      }, { requestId }),
      { status: 400 }
    );
  }

  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (_) {
    return Response.json(
      err({ code: "UNAUTHORIZED", message: "Authentication required", source: "INTERNAL" }, { requestId }),
      { status: 401 }
    );
  }

  try {
    const { stagedTargets } = await createStagedUploads(admin, { files: parsed.data.files });
    return Response.json(ok({ stagedTargets }, { requestId }));
  } catch (e) {
    logServerError("api.staged-uploads", e instanceof Error ? e : new Error(String(e)), { requestId });
    const code = e?.code === "USER_ERRORS" ? "SHOPIFY" : "INTERNAL";
    return Response.json(
      err({
        code: e?.code ?? "STAGED_UPLOAD_FAILED",
        message: e?.message ?? "Failed to create staged upload",
        source: code,
        retryable: e?.retryable ?? false,
      }, { requestId }),
      { status: e?.code === "USER_ERRORS" ? 400 : 502 }
    );
  }
}

export default function ApiStagedUploads() {
  return null;
}
