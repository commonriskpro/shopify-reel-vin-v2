/**
 * Single source of truth for VIN normalization, validation, and decode.
 * @see docs/DMS-STEP1-SPEC.md §8
 */

import { LRUCache } from "lru-cache";
import { fetchJsonWithPolicy } from "../http.server.js";

const NHTSA_BASE = "https://vpic.nhtsa.dot.gov/api";

const vinCache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24,
  allowStale: false,
  updateAgeOnGet: true,
});

export function normalizeVin(rawVin) {
  return String(rawVin ?? "").trim().toUpperCase();
}

export function isValidVin(vin) {
  return typeof vin === "string" && /^[A-HJ-NPR-Z0-9]{8,17}$/.test(vin);
}

/**
 * Decode VIN via NHTSA VPIC. Caller must ensure vin is normalized and valid.
 * @param {string} vin - normalized 8–17 char VIN
 * @returns {Promise<{ decoded: object; raw: object }>}
 */
export async function decodeVin(vin) {
  const v = normalizeVin(vin);
  if (!v || !isValidVin(v)) {
    throw new Error("Please provide a valid VIN (8–17 characters).");
  }

  const cached = vinCache.get(v);
  if (cached) return cached;

  const api = await fetchJsonWithPolicy(
    `${NHTSA_BASE}/vehicles/DecodeVinValues/${encodeURIComponent(v)}?format=json`,
    { headers: { Accept: "application/json" }, timeoutMs: 10_000, retries: 2 }
  );
  if (!api.ok) throw new Error("NHTSA API unavailable");

  const data = api.data;
  if (!data?.Results?.[0]) throw new Error("No decode results for this VIN.");

  const raw = data.Results[0];
  const decoded = {
    vin: raw.VIN,
    year: raw.ModelYear || null,
    make: raw.Make || null,
    manufacturer: raw.Manufacturer || null,
    model: raw.Model || null,
    series: raw.Series || null,
    trim: raw.Trim || raw.Trim2 || null,
    bodyClass: raw.BodyClass || null,
    vehicleType: raw.VehicleType || null,
    engineCylinders: raw.EngineCylinders || null,
    displacementL: raw.DisplacementL || null,
    fuelTypePrimary: raw.FuelTypePrimary || null,
    driveType: raw.DriveType || null,
    transmissionStyle: raw.TransmissionStyle || null,
    plantCity: raw.PlantCity || null,
    plantState: raw.PlantState || null,
    plantCountry: raw.PlantCountry || null,
    errorCode: raw.ErrorCode || null,
    errorText: raw.ErrorText || null,
  };

  const result = { decoded, raw };
  vinCache.set(v, result);
  return result;
}
