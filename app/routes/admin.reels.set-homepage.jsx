/**
 * Resource route: POST with reel_id & show_on_homepage to toggle.
 * GET is read-only and intentionally rejected to avoid state mutation via URL.
 */
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { fetchJsonWithPolicy, logServerError } from "../http.server.js";
import { enforceRateLimit, isValidReelId, normalizeReelId } from "../security.server.js";

const REELS_API_URL = (process.env.REELS_API_URL || "").trim().replace(/\/api\/reels\/?$/i, "") || "";
const REELS_ADMIN_SECRET = process.env.REELS_ADMIN_SECRET || "";

async function updateShowOnHomepage(reelId, showOnHomepage) {
  if (!REELS_API_URL || !REELS_ADMIN_SECRET) {
    return Response.json({ ok: false, error: "Reels API not configured" }, { status: 500 });
  }
  if (!reelId) {
    return Response.json({ ok: false, error: "Missing reel_id" }, { status: 400 });
  }
  const base = REELS_API_URL.replace(/\/$/, "");
  const authHeader = { Authorization: `Bearer ${REELS_ADMIN_SECRET}` };
  try {
    const api = await fetchJsonWithPolicy(`${base}/api/reels?id=${encodeURIComponent(reelId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ show_on_homepage: showOnHomepage }),
      retries: 1,
      timeoutMs: 9000,
    });
    const data = api.data || {};
    if (!api.ok) {
      const message = data?.error || data?.message || "Reels API request failed.";
      return Response.json({ ok: false, error: message }, { status: api.status >= 400 ? api.status : 502 });
    }
    return Response.json({ ok: true, show_on_homepage: data.show_on_homepage === true });
  } catch (err) {
    logServerError("admin.reels.set-homepage", err, { reelId });
    return Response.json({ ok: false, error: "Reels API request failed." }, { status: 502 });
  }
}

export async function loader({ request }) {
  await authenticate.admin(request);
  return Response.json(
    { ok: false, error: "Method not allowed. Use POST." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const limited = enforceRateLimit(request, {
    scope: "admin.reels.set-homepage",
    limit: 30,
    windowMs: 60_000,
    keyParts: [session?.shop || "unknown"],
  });
  if (!limited.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  let reelId, showOnHomepage;
  const contentType = request.headers.get("Content-Type") || "";
  const url = new URL(request.url);
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    reelId = form.get("reel_id");
    showOnHomepage = form.get("show_on_homepage") === "true";
  } else if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    reelId = body.reel_id ?? url.searchParams.get("reel_id");
    showOnHomepage = body.show_on_homepage === true || body.show_on_homepage === "true";
  } else {
    reelId = url.searchParams.get("reel_id");
    showOnHomepage = url.searchParams.get("show_on_homepage") === "true";
  }
  const reelIdTrimmed = normalizeReelId(reelId);
  if (!isValidReelId(reelIdTrimmed)) {
    return Response.json({ ok: false, error: "Invalid reel_id" }, { status: 400 });
  }
  return updateShowOnHomepage(reelIdTrimmed, showOnHomepage);
}

export function headers(headersArgs) {
  return boundary.headers(headersArgs);
}

export default function ReelsSetHomepageRoute() {
  return null;
}
