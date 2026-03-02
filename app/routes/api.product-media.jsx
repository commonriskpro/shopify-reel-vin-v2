/**
 * DEPRECATED: use /api/products/:productId/media. Thin shim: GET /api/product-media?productId=XXX and POST /api/product-media (body: productId, media). Returns fixed envelope.
 */
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { getProductMedia, addProductMedia } from "../services/product-media.server.js";
import { logServerError } from "../http.server.js";
import { makeRequestId, ok, err, zodErrorToFieldErrors, rejectIfBodyTooLarge } from "../lib/api-envelope.js";

const addMediaBodySchema = z.object({
  productId: z.string().min(1, "productId required").max(128, "productId too long"),
  media: z.array(z.object({
    originalSource: z.string(),
    mediaContentType: z.string().optional(),
    alt: z.string().optional(),
  })).min(1, "media array required"),
});

export async function loader({ request }) {
  const requestId = makeRequestId(request);
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) {
    return Response.json(
      err({ code: "VALIDATION", message: "productId required", source: "VALIDATION" }, { requestId }),
      { status: 400 }
    );
  }

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

  try {
    const { media } = await getProductMedia(admin, productId);
    return Response.json(ok({ media }, { requestId }));
  } catch (e) {
    logServerError("api.product-media.loader", e instanceof Error ? e : new Error(String(e)), { requestId });
    const isNotFound = e?.code === "NOT_FOUND";
    return Response.json(
      err({
        code: isNotFound ? "NOT_FOUND" : "MEDIA_FETCH_FAILED",
        message: e?.message ?? "Failed to load media",
        source: "SHOPIFY",
        retryable: !isNotFound,
      }, { requestId }),
      { status: isNotFound ? 404 : 502 }
    );
  }
}

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

  const parsed = addMediaBodySchema.safeParse(body);
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
  } catch (e) {
    return Response.json(
      err({ code: "UNAUTHORIZED", message: "Authentication required", source: "INTERNAL" }, { requestId }),
      { status: 401 }
    );
  }

  try {
    const { media } = await addProductMedia(admin, parsed.data.productId, parsed.data.media);
    return Response.json(ok({ media }, { requestId }));
  } catch (e) {
    logServerError("api.product-media.action", e instanceof Error ? e : new Error(String(e)), { requestId });
    return Response.json(
      err({
        code: e?.code ?? "MEDIA_ADD_FAILED",
        message: e?.message ?? "Failed to add media",
        source: e?.code === "USER_ERRORS" ? "SHOPIFY" : "INTERNAL",
        retryable: false,
      }, { requestId }),
      { status: e?.code === "USER_ERRORS" ? 400 : 502 }
    );
  }
}

export default function ApiProductMedia() {
  return null;
}
