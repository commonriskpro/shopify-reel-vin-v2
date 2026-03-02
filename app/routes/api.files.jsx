/**
 * GET /api/files?first=30&after=cursor — List shop files. Zod at edge, fixed envelope.
 */
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { listShopFiles } from "../services/files.server.js";
import { logServerError } from "../http.server.js";
import { makeRequestId, ok, err } from "../lib/api-envelope.js";

const querySchema = z.object({
  first: z.coerce.number().min(1).max(50).default(30),
  after: z.string().optional().nullable(),
});

export async function loader({ request }) {
  const requestId = makeRequestId(request);
  let admin;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
  } catch (e) {
    return Response.json(
      err({ code: "UNAUTHORIZED", message: "Authentication required", source: "INTERNAL" }, { requestId }),
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    first: url.searchParams.get("first") ?? 30,
    after: url.searchParams.get("after"),
  });
  if (!parsed.success) {
    return Response.json(
      err({
        code: "VALIDATION",
        message: parsed.error.errors.map((e) => e.message).join("; "),
        source: "VALIDATION",
      }, { requestId }),
      { status: 400 }
    );
  }

  try {
    const { nodes, pageInfo } = await listShopFiles(admin, {
      first: parsed.data.first,
      after: parsed.data.after ?? undefined,
    });
    return Response.json(ok({ nodes, pageInfo }, { requestId }));
  } catch (e) {
    logServerError("api.files", e instanceof Error ? e : new Error(String(e)), { requestId });
    return Response.json(
      err({
        code: "FILES_FAILED",
        message: e?.message ?? "Failed to load files",
        source: "SHOPIFY",
        retryable: e?.retryable ?? true,
      }, { requestId }),
      { status: 502 }
    );
  }
}

export default function ApiFiles() {
  return null;
}
