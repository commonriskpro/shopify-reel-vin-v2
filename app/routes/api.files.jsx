/**
 * GET /api/files?first=30&after=cursor — List shop files. Always returns application/json.
 */
import { z } from "zod";
import { apiRoute, requireAdmin, jsonOk, jsonFail, ApiError } from "../lib/api.server.js";
import { makeRequestId } from "../lib/api-envelope.js";
import { listFiles } from "../services/files.server.js";

const querySchema = z.object({
  first: z.coerce.number().min(1).max(50).default(30),
  after: z.string().optional().nullable(),
});

export const loader = apiRoute(async ({ request }) => {
  const requestId = makeRequestId(request);
  const { admin } = await requireAdmin(request);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    first: url.searchParams.get("first") ?? 30,
    after: url.searchParams.get("after"),
  });
  if (!parsed.success) {
    return jsonFail(
      { message: parsed.error.errors.map((e) => e.message).join("; "), code: "VALIDATION" },
      { status: 400 },
      { requestId }
    );
  }

  try {
    const { items, pageInfo } = await listFiles(admin, {
      first: parsed.data.first,
      after: parsed.data.after ?? undefined,
    });
    return jsonOk({ items, pageInfo }, {}, { requestId });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return jsonFail(
      { message: e?.message ?? "Failed to load files", code: "FILES_FAILED" },
      { status: 502 },
      { requestId }
    );
  }
});

export default function ApiFiles() {
  return null;
}
