import { describe, it, expect } from "vitest";
import {
  vehicleTitleFromDecoded,
  tagsFromDecoded,
} from "../app/services/vins.server.js";

describe("vehicleTitleFromDecoded", () => {
  it("joins year make model trim", () => {
    expect(
      vehicleTitleFromDecoded({
        year: "2021",
        make: "Honda",
        model: "Accord",
        trim: "EX-L",
      })
    ).toBe("2021 Honda Accord EX-L");
  });
  it("falls back to vehicleType", () => {
    expect(vehicleTitleFromDecoded({ vehicleType: "Sedan" })).toBe("Sedan");
  });
  it("falls back to Vehicle when empty", () => {
    expect(vehicleTitleFromDecoded({})).toBe("Vehicle");
  });
});

describe("tagsFromDecoded", () => {
  it("collects year make model trim fuel drive body vehicleType", () => {
    const tags = tagsFromDecoded({
      year: "2021",
      make: "Honda",
      model: "Accord",
      trim: "EX-L",
      fuelTypePrimary: "Gasoline",
      driveType: "FWD",
      bodyClass: "Sedan",
      vehicleType: "PASSENGER CAR",
    });
    expect(tags).toContain("2021");
    expect(tags).toContain("Honda");
    expect(tags).toContain("Accord");
    expect(tags).toContain("EX-L");
    expect(tags).toContain("Gasoline");
    expect(tags).toContain("FWD");
    expect(tags).toContain("Sedan");
    expect(tags).toContain("PASSENGER CAR");
  });
  it("returns empty array for empty decoded", () => {
    expect(tagsFromDecoded({})).toEqual([]);
  });
  it("limits to 20 tags", () => {
    const many = {};
    for (let i = 0; i < 25; i++) many[`f${i}`] = `v${i}`;
    const tags = tagsFromDecoded(many);
    expect(tags.length).toBeLessThanOrEqual(20);
  });
});
