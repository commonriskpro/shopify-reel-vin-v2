/**
 * DEPRECATED: use POST /api/staged-uploads. Shim that delegates to same logic.
 */
import { z } from "zod";
import { apiRoute, requireAdmin, jsonOk, jsonFail, parseJsonBody } from "../lib/api.server.js";
import { makeRequestId } from "../lib/api-envelope.js";
import { createStagedUploads } from "../services/staged-uploads.server.js";

const fileSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  fileSize: z.union([z.number(), z.string()]).transform((v) => String(v)),
});
const bodySchema = z.object({
  files: z.array(fileSchema).min(1, "files array required"),
});

export const action = apiRoute(async ({ request }) => {
  const requestId = makeRequestId(request);
  if (request.method !== "POST") {
    return jsonFail({ message: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 }, { requestId });
  }
  const body = await parseJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonFail(
      { message: parsed.error.errors.map((e) => e.message).join("; "), code: "VALIDATION" },
      { status: 400 },
      { requestId }
    );
  }

  const { admin } = await requireAdmin(request);

  const normalizedFiles = parsed.data.files.map((f) => ({
    filename: f.filename,
    mimeType: f.mimeType,
    resource: f.mimeType.toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE",
    fileSize: f.fileSize,
  }));
  const { stagedTargets } = await createStagedUploads(admin, { files: normalizedFiles });
  return jsonOk({ stagedTargets }, {}, { requestId });
});

export default function ApiStagedUpload() {
  return null;
}
