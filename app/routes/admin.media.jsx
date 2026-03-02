/**
 * /admin/media — Consolidated media data route for the embedded admin UI.
 *
 * WHY THIS ELIMINATES shop:null FAILURES (PR summary):
 *   The previous architecture routed media operations through /api/* endpoints.
 *   Each request to /api/* had to independently obtain a Shopify session token
 *   from App Bridge (window.shopify.getSessionToken()). If App Bridge had not
 *   finished initialising — a race that occurs intermittently in production —
 *   the call threw or returned null, the Authorization header was not set, and
 *   authenticate.admin(request) could not resolve the shop from the request,
 *   logging "shop: null" and returning a Vercel 502.
 *
 *   This route is under /admin/*. React Router's useFetcher submits to it with
 *   the Shopify session cookie that was set during the OAuth installation flow.
 *   authenticate.admin() resolves the session from the cookie without ever
 *   needing App Bridge's getSessionToken(). There is no race condition, no
 *   bearer token to obtain, and no possibility of shop:null from a missing header.
 *
 * Loader — GET /admin/media?intent=...
 *   ?intent=files&first=30&after=cursor  → list Shopify Files
 *   ?intent=product-media&productId=gid  → list product media nodes
 *
 * Action — POST /admin/media (application/json)
 *   { intent: "staged-uploads",    files: [...] }           → create staged upload targets
 *   { intent: "add-product-media", productId, media: [...] } → attach media to product
 *
 * All responses: { ok: true|false, data?, error?, meta?: { requestId } }
 */
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { makeRequestId } from "../lib/api-envelope.js";
import { logServerError } from "../http.server.js";
import { ApiError } from "../lib/api.server.js";
import { listFiles } from "../services/files.server.js";
import { createStagedUploads } from "../services/staged-uploads.server.js";
import { getProductMedia, attachMediaToProduct } from "../services/product-media.server.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ok(data, requestId) {
  return Response.json(
    { ok: true, data, meta: { requestId } },
    { headers: { "x-request-id": requestId } }
  );
}

function fail(message, code, status, requestId, details) {
  return Response.json(
    {
      ok: false,
      error: { message, code, ...(details != null ? { details } : {}) },
      meta: { requestId },
    },
    { status, headers: { "x-request-id": requestId } }
  );
}

async function resolveAdmin(request, requestId) {
  try {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) {
      throw new ApiError(401, "Auth redirect — session or shop missing", { code: "UNAUTHORIZED" });
    }
    if (!auth?.session?.shop) {
      throw new ApiError(401, "Unauthorized (shop not resolved)", { code: "UNAUTHORIZED" });
    }
    return { admin: auth.admin, session: auth.session };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Response) {
      throw new ApiError(401, "Auth redirect — session or shop missing", { code: "UNAUTHORIZED" });
    }
    throw new ApiError(401, "Authentication required", { code: "UNAUTHORIZED" });
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const filesQuerySchema = z.object({
  first: z.coerce.number().int().min(1).max(50).default(30),
  after: z.string().nullish(),
});

const productIdSchema = z.string().min(1).max(256);

const fileInputSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.union([z.number(), z.string()]).transform((v) => String(v)),
});

const actionBodySchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("staged-uploads"),
    files: z.array(fileInputSchema).min(1, "files required"),
  }),
  z.object({
    intent: z.literal("add-product-media"),
    productId: z.string().min(1).max(256),
    media: z
      .array(
        z.object({
          originalSource: z.string().min(1),
          mediaContentType: z.string().optional(),
          alt: z.string().optional(),
        })
      )
      .min(1, "media required"),
  }),
]);

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }) => {
  const requestId = makeRequestId(request);

  let admin;
  try {
    ({ admin } = await resolveAdmin(request, requestId));
  } catch (e) {
    return fail(e.message, e.code ?? "UNAUTHORIZED", 401, requestId);
  }

  const url = new URL(request.url);
  const intent = url.searchParams.get("intent");

  // GET files list (/admin/media?intent=files&first=30&after=cursor)
  if (intent === "files") {
    const parsed = filesQuerySchema.safeParse({
      first: url.searchParams.get("first") ?? 30,
      after: url.searchParams.get("after"),
    });
    if (!parsed.success) {
      return fail(
        parsed.error.errors.map((e) => e.message).join("; "),
        "VALIDATION",
        400,
        requestId
      );
    }
    try {
      const { items, pageInfo } = await listFiles(admin, {
        first: parsed.data.first,
        after: parsed.data.after ?? undefined,
      });
      return ok({ items, pageInfo }, requestId);
    } catch (e) {
      logServerError("admin.media.files", e, { requestId });
      return fail(e?.message ?? "Failed to load files", "FILES_FAILED", 502, requestId);
    }
  }

  // GET product media (/admin/media?intent=product-media&productId=gid)
  if (intent === "product-media") {
    const parsed = productIdSchema.safeParse(url.searchParams.get("productId") ?? "");
    if (!parsed.success) {
      return fail("productId required", "VALIDATION", 400, requestId);
    }
    try {
      const { media } = await getProductMedia(admin, parsed.data);
      return ok({ media }, requestId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        return fail(e.message, "NOT_FOUND", 404, requestId);
      }
      logServerError("admin.media.product-media", e, { requestId });
      return fail(e?.message ?? "Failed to load product media", "MEDIA_FETCH_FAILED", 502, requestId);
    }
  }

  return fail("Unknown intent. Use ?intent=files or ?intent=product-media", "VALIDATION", 400, requestId);
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }) => {
  const requestId = makeRequestId(request);

  if (request.method !== "POST") {
    return fail("Method not allowed", "METHOD_NOT_ALLOWED", 405, requestId);
  }

  let admin;
  try {
    ({ admin } = await resolveAdmin(request, requestId));
  } catch (e) {
    return fail(e.message, e.code ?? "UNAUTHORIZED", 401, requestId);
  }

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return fail("Invalid JSON body", "INVALID_JSON", 400, requestId);
  }

  const parsed = actionBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail(
      parsed.error.errors.map((e) => e.message).join("; "),
      "VALIDATION",
      400,
      requestId
    );
  }

  // POST {intent: "staged-uploads", files: [...]}
  if (parsed.data.intent === "staged-uploads") {
    const normalizedFiles = parsed.data.files.map((f) => ({
      filename: f.filename,
      mimeType: f.mimeType,
      resource: f.mimeType.toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE",
      fileSize: f.fileSize,
    }));
    try {
      const { stagedTargets } = await createStagedUploads(admin, { files: normalizedFiles });
      return ok({ stagedTargets }, requestId);
    } catch (e) {
      logServerError("admin.media.staged-uploads", e, { requestId });
      const status = e instanceof ApiError ? e.status : 502;
      return fail(e?.message ?? "Staged upload failed", e?.code ?? "STAGED_UPLOAD_FAILED", status, requestId);
    }
  }

  // POST {intent: "add-product-media", productId, media: [...]}
  if (parsed.data.intent === "add-product-media") {
    try {
      const result = await attachMediaToProduct(admin, {
        productId: parsed.data.productId,
        media: parsed.data.media,
      });
      return ok(result, requestId);
    } catch (e) {
      logServerError("admin.media.add-product-media", e, { requestId });
      const status = e instanceof ApiError ? e.status : 502;
      return fail(e?.message ?? "Failed to add media", e?.code ?? "MEDIA_ADD_FAILED", status, requestId);
    }
  }

  return fail("Unknown intent", "VALIDATION", 400, requestId);
};

// This route returns only JSON; no UI is rendered from it directly.
export default function AdminMediaRoute() {
  return null;
}
