/**
 * API envelope + validation tests for GET /api/vins.
 * Mocks auth and rate limit; asserts error shape for invalid VIN and upstream failure.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/shopify.server.js", () => ({
  authenticate: {
    admin: vi.fn().mockResolvedValue({ session: { shop: "test-shop" }, admin: {} }),
  },
}));
vi.mock("../app/security.server.js", () => ({
  enforceRateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSeconds: 0 }),
}));
vi.mock("../app/services/vins.server.js", () => ({
  decodeVin: vi.fn().mockRejectedValue(new Error("VPIC upstream error")),
  normalizeVin: (v) => String(v ?? "").trim().toUpperCase(),
  isValidVin: (v) => typeof v === "string" && /^[A-HJ-NPR-Z0-9]{8,17}$/.test(v),
}));

const { loader } = await import("../app/routes/api.vins.jsx");

describe("GET /api/vins envelope", () => {
  it("invalid VIN returns ok:false, error.source=VALIDATION, fieldErrors.vin, meta.requestId", async () => {
    const request = new Request("http://localhost/api/vins?vin=1", {
      headers: { "x-request-id": "req-invalid-vin" },
    });
    const response = await loader({ request });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.source).toBe("VALIDATION");
    expect(json.error.fieldErrors).toBeDefined();
    expect(json.error.fieldErrors.vin).toBeDefined();
    expect(Array.isArray(json.error.fieldErrors.vin)).toBe(true);
    expect(json.meta).toBeDefined();
    expect(json.meta.requestId).toBe("req-invalid-vin");
  });

  it("upstream (VPIC) failure returns ok:false, error.source=VPIC, retryable, meta.requestId", async () => {
    const request = new Request("http://localhost/api/vins?vin=1HGBH41JXMN109186", {
      headers: { "x-request-id": "req-vpic-fail" },
    });
    const response = await loader({ request });
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.source).toBe("VPIC");
    expect(json.error.retryable).toBeDefined();
    expect(json.meta).toBeDefined();
    expect(json.meta.requestId).toBe("req-vpic-fail");
  });
});
