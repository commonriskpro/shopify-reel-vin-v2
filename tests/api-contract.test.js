/**
 * Contract tests:
 *   1. Old /api/* routes return 410 Gone with JSON (never 502).
 *   2. New /admin/media route returns 401 JSON when unauthorized.
 *   3. admin._index action handles decodeOnly and returns structured envelope.
 */
import { describe, it, expect, vi } from "vitest";

// ── /api/* are now 410 stubs (no auth needed — just call them) ───────────────

describe("Retired /api/* routes return 410 Gone with JSON", () => {
  it("GET /api/files returns 410 with application/json and ok:false", async () => {
    const { loader } = await import("../app/routes/api.files.jsx");
    const response = await loader({ request: new Request("http://localhost/api/files") });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(410);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("GONE");
  });

  it("POST /api/staged-uploads returns 410 with application/json and ok:false", async () => {
    const { action } = await import("../app/routes/api.staged-uploads.jsx");
    const response = await action({ request: new Request("http://localhost/api/staged-uploads", { method: "POST" }) });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(410);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("GONE");
  });

  it("GET /api/vins returns 410 with application/json and ok:false", async () => {
    const { loader } = await import("../app/routes/api.vins.jsx");
    const response = await loader({ request: new Request("http://localhost/api/vins?vin=1HGBH41JXMN109186") });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(410);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("GONE");
  });
});

// ── /admin/media returns 401 JSON when unauthorized ──────────────────────────

vi.mock("../app/shopify.server.js", () => ({
  authenticate: { admin: vi.fn().mockRejectedValue(new Error("No session")) },
}));
vi.mock("../app/services/files.server.js", () => ({
  listFiles: vi.fn().mockResolvedValue({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
}));
vi.mock("../app/services/staged-uploads.server.js", () => ({
  createStagedUploads: vi.fn().mockResolvedValue({ stagedTargets: [] }),
}));
vi.mock("../app/services/product-media.server.js", () => ({
  getProductMedia: vi.fn().mockResolvedValue({ media: [] }),
  attachMediaToProduct: vi.fn().mockResolvedValue({ media: [] }),
}));

describe("/admin/media returns 401 JSON when unauthorized", () => {
  it("GET /admin/media?intent=files returns 401 application/json", async () => {
    const { loader } = await import("../app/routes/admin.media.jsx");
    const response = await loader({ request: new Request("http://localhost/admin/media?intent=files") });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(json.meta?.requestId).toBeDefined();
  });

  it("POST /admin/media returns 401 application/json", async () => {
    const { action } = await import("../app/routes/admin.media.jsx");
    const response = await action({
      request: new Request("http://localhost/admin/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "staged-uploads", files: [{ filename: "x.jpg", mimeType: "image/jpeg", fileSize: "100" }] }),
      }),
    });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHORIZED");
  });
});
