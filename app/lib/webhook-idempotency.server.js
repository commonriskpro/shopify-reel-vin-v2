/**
 * Webhook idempotency: dedupe by Shopify webhook/event id so retries don't re-run handlers.
 * Uses in-memory LRU with TTL; for multi-instance deploy consider Redis/DB later.
 * @see docs/security-qa-plan.md F1
 */
import { LRUCache } from "lru-cache";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_IDS = 10000;

const processedIds = new LRUCache({ max: MAX_IDS, ttl: TTL_MS });

/**
 * Get webhook id from request headers (Shopify sends X-Shopify-Webhook-Id or X-Shopify-Event-Id).
 * @param {Request} request
 * @returns {string | null}
 */
export function getWebhookId(request) {
  const eventId = request.headers.get("x-shopify-event-id");
  if (eventId && eventId.trim()) return eventId.trim();
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (webhookId && webhookId.trim()) return webhookId.trim();
  return null;
}

/**
 * Returns true if this webhook id was already processed (duplicate). Call before authenticate.webhook.
 * @param {string | null} id
 * @returns {boolean}
 */
export function hasProcessedWebhookId(id) {
  return !!(id && typeof id === "string" && processedIds.has(id));
}

/**
 * Mark webhook id as processed. Call after successful handling so retries get 200 and skip.
 * @param {string | null} id
 */
export function markWebhookIdProcessed(id) {
  if (id && typeof id === "string") processedIds.set(id, true);
}
