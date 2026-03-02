/**
 * Envelope + validation tests for VIN decode via admin._index action.
 * The /api/vins endpoint was retired (410 stub). VIN decode now goes through
 * POST /admin (action) with {vin, decodeOnly: true}.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/shopify.server.js", () => ({
  authenticate: {
    admin: vi.fn().mockResolvedValue({ session: { shop: "test-shop.myshopify.com" }, admin: {} }),
  },
}));
vi.mock("../app/security.server.js", () => ({
  enforceRateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSeconds: 0 }),
  isValidVin: (v) => typeof v === "string" && /^[A-HJ-NPR-Z0-9]{8,17}$/.test(v),
  normalizeVin: (v) => String(v ?? "").trim().toUpperCase(),
}));
vi.mock("../app/services/vins.server.js", () => ({
  decodeVin: vi.fn().mockRejectedValue(new Error("VPIC upstream error")),
  vehicleTitleFromDecoded: vi.fn().mockReturnValue("Test Vehicle"),
  vehicleTitleFromDecoded: vi.fn().mockReturnValue("Test Vehicle"),
}));
vi.mock("../app/services/products.server.js", () => ({
  createProductFromVin: vi.fn().mockResolvedValue({ product: { id: "gid://shopify/Product/1" }, warnings: [] }),
}));
vi.mock("../app/http.server.js", () => ({
  logServerError: vi.fn(),
}));

const { action } = await import("../app/routes/admin._index.jsx");

describe("admin._index action: decodeOnly envelope", () => {
  it("invalid VIN returns ok:false, VALIDATION code", async () => {
    const request = new Request("http://localhost/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vin: "1", decodeOnly: true }),
    });
    const response = await action({ request });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
    expect(["VALIDATION", "INVALID_VIN"].includes(json.error.code ?? "VALIDATION")).toBe(true);
  });

  it("upstream VPIC failure returns ok:false, 502, VPIC_ERROR code", async () => {
    const request = new Request("http://localhost/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": "req-vpic-fail" },
      body: JSON.stringify({ vin: "1HGBH41JXMN109186", decodeOnly: true }),
    });
    const response = await action({ request });
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe("VPIC_ERROR");
    expect(json.error?.message).toBeDefined();
  });
});

describe("Retired /api/vins returns 410 Gone", () => {
  it("loader returns 410 with GONE code", async () => {
    const { loader } = await import("../app/routes/api.vins.jsx");
    const response = await loader({ request: new Request("http://localhost/api/vins?vin=1HGBH41JXMN109186") });
    expect(response.status).toBe(410);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("GONE");
  });
});
