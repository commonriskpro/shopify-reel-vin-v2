const rateBuckets = new Map();

function getNow() {
  return Date.now();
}

function cleanupRateBuckets(now) {
  if (rateBuckets.size < 5000) return;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}

function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export function enforceRateLimit(request, { scope, limit, windowMs, keyParts = [] }) {
  const now = getNow();
  cleanupRateBuckets(now);
  const key = [scope, getClientIp(request), ...keyParts].join(":");
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

// Re-export from single source (app/lib/vin.server.js)
export { normalizeVin, isValidVin } from "./lib/vin.server.js";

export function normalizeProductHandle(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function isValidProductHandle(handle) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle);
}

export function normalizeReelId(raw) {
  return String(raw || "").trim();
}

export function isValidReelId(reelId) {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(reelId);
}
