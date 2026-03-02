import { describe, it, expect } from "vitest";
import { makeRequestId, ok, err, zodErrorToFieldErrors, rejectIfBodyTooLarge, MAX_JSON_BODY_BYTES } from "../app/lib/api-envelope.js";
import { z } from "zod";

describe("makeRequestId", () => {
  it("returns uuid-like string when no request", () => {
    const id = makeRequestId(null);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(10);
  });
  it("returns x-request-id from request when present", () => {
    const id = makeRequestId({
      headers: { get: (k) => (k === "x-request-id" ? "custom-id-123" : null) },
    });
    expect(id).toBe("custom-id-123");
  });
});

describe("ok", () => {
  it("returns ok: true and data", () => {
    const res = ok({ decoded: {}, raw: {} });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ decoded: {}, raw: {} });
  });
  it("includes meta.requestId when provided", () => {
    const res = ok({ x: 1 }, { requestId: "req-1" });
    expect(res.meta?.requestId).toBe("req-1");
  });
  it("includes meta.warnings when provided", () => {
    const res = ok({ x: 1 }, { warnings: [{ code: "W1", message: "warn" }] });
    expect(res.meta?.warnings).toHaveLength(1);
    expect(res.meta?.warnings[0].code).toBe("W1");
  });
});

describe("err", () => {
  it("returns ok: false and error with code and message", () => {
    const res = err({ code: "VALIDATION", message: "Invalid" });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("VALIDATION");
    expect(res.error.message).toBe("Invalid");
  });
  it("includes source and fieldErrors when provided", () => {
    const res = err({
      code: "V",
      message: "Bad",
      source: "VALIDATION",
      fieldErrors: { vin: ["Required"] },
    });
    expect(res.error.source).toBe("VALIDATION");
    expect(res.error.fieldErrors).toEqual({ vin: ["Required"] });
  });
  it("includes meta.requestId when provided", () => {
    const res = err({ code: "E", message: "Err" }, { requestId: "req-42" });
    expect(res.meta?.requestId).toBe("req-42");
  });
});

describe("rejectIfBodyTooLarge", () => {
  it("returns null when Content-Length is under limit", () => {
    const request = new Request("http://localhost", { headers: { "content-length": "1000" } });
    expect(rejectIfBodyTooLarge(request)).toBe(null);
  });
  it("returns 413 Response when Content-Length exceeds limit", () => {
    const request = new Request("http://localhost", { headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) } });
    const res = rejectIfBodyTooLarge(request);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(413);
  });
});

describe("zodErrorToFieldErrors", () => {
  it("converts ZodError to field -> messages map", () => {
    const schema = z.object({ vin: z.string().min(1), count: z.number().min(0) });
    const result = schema.safeParse({ vin: "", count: -1 });
    expect(result.success).toBe(false);
    const fieldErrors = zodErrorToFieldErrors(result.error);
    expect(Object.keys(fieldErrors).length).toBeGreaterThan(0);
  });
});
