import { describe, it, expect } from "vitest";
import { normalizeVin, isValidVin } from "../app/lib/vin.server.js";

describe("normalizeVin", () => {
  it("trims and uppercases", () => {
    expect(normalizeVin("  1hgbh41jxmn109186  ")).toBe("1HGBH41JXMN109186");
    expect(normalizeVin("1HGBH41JXMN109186")).toBe("1HGBH41JXMN109186");
  });
  it("handles empty/null", () => {
    expect(normalizeVin("")).toBe("");
    expect(normalizeVin(null)).toBe("");
    expect(normalizeVin(undefined)).toBe("");
  });
});

describe("isValidVin", () => {
  it("accepts valid 8-17 alphanumeric (no I,O,Q)", () => {
    expect(isValidVin("1HGBH41JXMN109186")).toBe(true);
    expect(isValidVin("12345678")).toBe(true);
    expect(isValidVin("ABCDEFGH")).toBe(true);
  });
  it("rejects too short", () => {
    expect(isValidVin("1234567")).toBe(false);
    expect(isValidVin("")).toBe(false);
  });
  it("rejects invalid characters I, O, Q", () => {
    expect(isValidVin("1HGBH41JXMN10918I")).toBe(false);
    expect(isValidVin("1HGBH41JXMN10918O")).toBe(false);
    expect(isValidVin("1HGBH41JXMN10918Q")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isValidVin(123)).toBe(false);
  });
});
