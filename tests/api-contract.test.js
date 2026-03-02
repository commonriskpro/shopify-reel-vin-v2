/**
 * Contract tests: /api/* routes return application/json and 401 JSON envelope when unauthorized.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/shopify.server.js", () => ({
  authenticate: { admin: vi.fn().mockRejectedValue(new Error("No session")) },
}));
vi.mock("../app/security.server.js", () => ({
  enforceRateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSeconds: 0 }),
}));
vi.mock("../app/services/vins.server.js", () => ({
  decodeVin: vi.fn(),
  normalizeVin: (v) => String(v ?? "").trim().toUpperCase(),
  isValidVin: () => true,
}));
vi.mock("../app/services/files.server.js", () => ({
  listFiles: vi.fn().mockResolvedValue({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
}));
vi.mock("../app/services/staged-uploads.server.js", () => ({
  createStagedUploads: vi.fn().mockResolvedValue({ stagedTargets: [] }),
}));

describe("API contract: JSON-only and 401 when unauthorized", () => {
  it("GET /api/vins returns 401 with application/json and ok:false envelope", async () => {
    const { loader } = await import("../app/routes/api.vins.jsx");
    const request = new Request("http://localhost/api/vins?vin=1HGBH41JXMN109186");
    const response = await loader({ request });

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
    expect(typeof json.error.message).toBe("string");
  });

  it("GET /api/files returns 401 with application/json and ok:false envelope", async () => {
    const { loader } = await import("../app/routes/api.files.jsx");
    const request = new Request("http://localhost/api/files?first=10");
    const response = await loader({ request });

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
  });

  it("POST /api/staged-uploads returns 401 with application/json", async () => {
    const { action } = await import("../app/routes/api.staged-uploads.jsx");
    const request = new Request("http://localhost/api/staged-uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ filename: "x.jpg", mimeType: "image/jpeg", fileSize: "100" }] }),
    });
    const response = await action({ request });

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBeDefined();
  });
});
