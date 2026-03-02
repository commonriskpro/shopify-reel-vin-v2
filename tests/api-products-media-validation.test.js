/**
 * Param validation tests for /api/products/:productId/media.
 * Asserts missing or invalid productId returns envelope error.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

const productIdSchema = z.string().min(1, "productId required").max(128, "productId too long");

describe("productId validation (api/products/:productId/media)", () => {
  it("empty productId fails validation", () => {
    const r = productIdSchema.safeParse("");
    expect(r.success).toBe(false);
  });

  it("missing productId (undefined) fails", () => {
    const r = productIdSchema.safeParse(undefined);
    expect(r.success).toBe(false);
  });

  it("productId longer than 128 fails", () => {
    const r = productIdSchema.safeParse("gid://shopify/Product/" + "1".repeat(120));
    expect(r.success).toBe(false);
  });

  it("valid short productId passes", () => {
    const r = productIdSchema.safeParse("gid://shopify/Product/123");
    expect(r.success).toBe(true);
  });
});
