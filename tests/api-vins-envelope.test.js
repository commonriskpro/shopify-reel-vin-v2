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

// Import via the shared handler (moved to .server.js to fix React Router bundling)
const { loader } = await import("../app/routes/api.vins.jsx");

describe("GET /api/vins envelope", () => {
  it("invalid VIN returns ok:false, error.code, error.details.fieldErrors, meta.requestId", async () => {
    const request = new Request("http://localhost/api/vins?vin=1", {
      headers: { "x-request-id": "req-invalid-vin" },
    });
    const response = await loader({ request });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.message).toBeDefined();
    expect(["VALIDATION", "INVALID_VIN"].includes(json.error.code)).toBe(true);
    expect(json.error.details?.fieldErrors?.vin ?? json.error.fieldErrors?.vin).toBeDefined();
    expect(json.meta).toBeDefined();
    expect(json.meta.requestId).toBe("req-invalid-vin");
  });

  it("upstream (VPIC) failure returns ok:false, error.code=VPIC_ERROR, meta.requestId", async () => {
    const request = new Request("http://localhost/api/vins?vin=1HGBH41JXMN109186", {
      headers: { "x-request-id": "req-vpic-fail" },
    });
    const response = await loader({ request });
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe("VPIC_ERROR");
    expect(json.error?.message).toBeDefined();
    expect(json.meta).toBeDefined();
    expect(json.meta.requestId).toBe("req-vpic-fail");
  });
});
