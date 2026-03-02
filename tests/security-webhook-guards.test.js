import { describe, it, expect, beforeEach } from "vitest";
import { enforceRateLimit } from "../app/security.server.js";
import {
  getWebhookId,
  hasProcessedWebhookId,
  markWebhookIdProcessed,
} from "../app/lib/webhook-idempotency.server.js";
import { requireJsonPost } from "../app/lib/request-guards.server.js";

describe("enforceRateLimit", () => {
  function mockRequest(ip = "192.168.1.1") {
    return {
      headers: {
        get: (k) => (k === "x-forwarded-for" ? ip : k === "x-real-ip" ? null : null),
      },
    };
  }

  it("allows first request", () => {
    const r = enforceRateLimit(mockRequest(), {
      scope: "test",
      limit: 2,
      windowMs: 60_000,
      keyParts: ["shop1"],
    });
    expect(r.ok).toBe(true);
    expect(r.retryAfterSeconds).toBe(0);
  });

  it("allows up to limit", () => {
    const req = mockRequest();
    const opts = { scope: "test-limit", limit: 2, windowMs: 60_000, keyParts: ["shop2"] };
    expect(enforceRateLimit(req, opts).ok).toBe(true);
    expect(enforceRateLimit(req, opts).ok).toBe(true);
    const third = enforceRateLimit(req, opts);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("webhook idempotency", () => {
  beforeEach(() => {
    // Clear state between tests (module uses a single LRU; we can't clear it without exporting)
    // So we use unique ids per test
  });

  it("getWebhookId returns x-shopify-event-id when present", () => {
    const req = { headers: { get: (k) => (k === "x-shopify-event-id" ? " ev-123 " : null) } };
    expect(getWebhookId(req)).toBe("ev-123");
  });

  it("getWebhookId returns x-shopify-webhook-id when event-id absent", () => {
    const req = { headers: { get: (k) => (k === "x-shopify-webhook-id" ? " wh-456 " : null) } };
    expect(getWebhookId(req)).toBe("wh-456");
  });

  it("getWebhookId returns null when neither header present", () => {
    const req = { headers: { get: () => null } };
    expect(getWebhookId(req)).toBe(null);
  });

  it("hasProcessedWebhookId is false until markWebhookIdProcessed", () => {
    const id = "idempotent-" + Date.now();
    expect(hasProcessedWebhookId(id)).toBe(false);
    markWebhookIdProcessed(id);
    expect(hasProcessedWebhookId(id)).toBe(true);
  });

  it("hasProcessedWebhookId returns false for null/empty", () => {
    expect(hasProcessedWebhookId(null)).toBe(false);
    expect(hasProcessedWebhookId("")).toBe(false);
  });
});

describe("requireJsonPost", () => {
  it("returns null when Content-Type is application/json and size under limit", () => {
    const req = {
      headers: { get: (k) => (k === "content-type" ? "application/json" : k === "content-length" ? "10" : null) },
    };
    expect(requireJsonPost(req)).toBe(null);
  });

  it("returns 415 Response when Content-Type is not application/json", () => {
    const req = {
      headers: { get: (k) => (k === "content-type" ? "text/plain" : null) },
    };
    const res = requireJsonPost(req);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(415);
  });

  it("returns 413 Response when Content-Length exceeds maxBytes", () => {
    const req = {
      headers: {
        get: (k) =>
          k === "content-type"
            ? "application/json"
            : k === "content-length"
              ? "99999999"
              : null,
      },
    };
    const res = requireJsonPost(req, { maxBytes: 1000 });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(413);
  });
});
