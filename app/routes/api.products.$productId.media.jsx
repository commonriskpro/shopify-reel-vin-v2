/**
 * GET/POST /api/products/:productId/media — List or add product media. Zod at edge, fixed envelope.
 */
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { getProductMedia, addProductMedia } from "../services/product-media.server.js";
import { logServerError } from "../http.server.js";
import { makeRequestId, ok, err, zodErrorToFieldErrors, rejectIfBodyTooLarge } from "../lib/api-envelope.js";

const productIdSchema = z.string().min(1, "productId required").max(128, "productId too long");

const addMediaBodySchema = z.object({
  media: z.array(z.object({
    originalSource: z.string(),
    mediaContentType: z.string().optional(),
    alt: z.string().optional(),
  })).min(1, "media array required"),
});

export async function loader({ request, params }) {
  const requestId = makeRequestId(request);
  const parsed = productIdSchema.safeParse(params?.productId);
  if (!parsed.success) {
    return Response.json(
      err({ code: "VALIDATION", message: "productId required", source: "VALIDATION" }, { requestId }),
      { status: 400 }
    );
  }
  const productId = parsed.data;

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
    logServerError("api.products.media.loader", e instanceof Error ? e : new Error(String(e)), { requestId });
    const isNotFound = e?.message?.includes("not found") || e?.code === "NOT_FOUND";
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

export async function action({ request, params }) {
  const requestId = makeRequestId(request);
  if (request.method !== "POST") {
    return Response.json(
      err({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed", source: "VALIDATION" }, { requestId }),
      { status: 405 }
    );
  }

  const paramParsed = productIdSchema.safeParse(params?.productId);
  if (!paramParsed.success) {
    return Response.json(
      err({ code: "VALIDATION", message: "productId required", source: "VALIDATION" }, { requestId }),
      { status: 400 }
    );
  }
  const productId = paramParsed.data;

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
    const { media } = await addProductMedia(admin, productId, parsed.data.media);
    return Response.json(ok({ media }, { requestId }));
  } catch (e) {
    logServerError("api.products.media.action", e instanceof Error ? e : new Error(String(e)), { requestId });
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

export default function ApiProductsProductIdMedia() {
  return null;
}
