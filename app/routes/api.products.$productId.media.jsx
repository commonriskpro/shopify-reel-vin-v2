/**
 * GET/POST /api/products/:productId/media — List or add product media. Always returns application/json.
 */
import { z } from "zod";
import { apiRoute, requireAdmin, jsonOk, jsonFail, ApiError, parseJsonBody } from "../lib/api.server.js";
import { makeRequestId } from "../lib/api-envelope.js";
import { getProductMedia, attachMediaToProduct } from "../services/product-media.server.js";

const productIdSchema = z.string().min(1, "productId required").max(128, "productId too long");
const addMediaBodySchema = z.object({
  media: z.array(z.object({
    originalSource: z.string(),
    mediaContentType: z.string().optional(),
    alt: z.string().optional(),
  })).min(1, "media array required"),
});

export const loader = apiRoute(async ({ request, params }) => {
  const requestId = makeRequestId(request);
  const parsed = productIdSchema.safeParse(params?.productId);
  if (!parsed.success) {
    return jsonFail({ message: "productId required", code: "VALIDATION" }, { status: 400 }, { requestId });
  }
  const productId = parsed.data;
  const { admin } = await requireAdmin(request);

  try {
    const { media } = await getProductMedia(admin, productId);
    return jsonOk({ media }, {}, { requestId });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return jsonFail({ message: e.message, code: "NOT_FOUND" }, { status: 404 }, { requestId });
    }
    if (e instanceof ApiError) throw e;
    return jsonFail(
      { message: e?.message ?? "Failed to load media", code: "MEDIA_FETCH_FAILED" },
      { status: 502 },
      { requestId }
    );
  }
});

export const action = apiRoute(async ({ request, params }) => {
  const requestId = makeRequestId(request);
  if (request.method !== "POST") {
    return jsonFail({ message: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, { status: 405 }, { requestId });
  }

  const paramParsed = productIdSchema.safeParse(params?.productId);
  if (!paramParsed.success) {
    return jsonFail({ message: "productId required", code: "VALIDATION" }, { status: 400 }, { requestId });
  }
  const productId = paramParsed.data;

  const body = await parseJsonBody(request);
  const parsed = addMediaBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonFail(
      { message: parsed.error.errors.map((e) => e.message).join("; "), code: "VALIDATION" },
      { status: 400 },
      { requestId }
    );
  }

  const { admin } = await requireAdmin(request);

  const result = await attachMediaToProduct(admin, { productId, media: parsed.data.media });
  return jsonOk(result, {}, { requestId });
});

export default function ApiProductsProductIdMedia() {
  return null;
}
