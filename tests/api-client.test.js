/**
 * apiFetch client helper tests: NETWORK_ERROR and BAD_RESPONSE.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "../app/lib/api-client.js";

describe("apiFetch", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns NETWORK_ERROR on fetch rejection", async () => {
    globalThis.fetch.mockRejectedValue(new Error("Network failure"));
    const result = await apiFetch("/api/test");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NETWORK_ERROR");
    expect(result.error?.message).toMatch(/network|failure/i);
  });

  it("returns BAD_RESPONSE on non-JSON response", async () => {
    globalThis.fetch.mockResolvedValue({
      headers: { get: () => null },
      text: () => Promise.resolve("not json at all"),
    });
    const result = await apiFetch("/api/test");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BAD_RESPONSE");
  });
});
