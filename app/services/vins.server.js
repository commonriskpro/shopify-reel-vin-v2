/**
 * VIN service: single source for decode + builders. Uses lib/vin for normalize/validate/decode.
 */
import { decodeVin, isValidVin, normalizeVin } from "../lib/vin.server.js";

export { normalizeVin, isValidVin, decodeVin };

function escapeHtml(s) {
  if (s == null || typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortVehicleType(bodyClass, vehicleType) {
  const raw = `${bodyClass || ""} ${vehicleType || ""}`.toLowerCase();
  if (raw.includes("suv") || raw.includes("sport utility") || raw.includes("multipurpose") || raw.includes("mpv")) return "SUV";
  if (raw.includes("truck") || raw.includes("pickup")) return "Truck";
  if (raw.includes("van")) return "Van";
  if (raw.includes("coupe")) return "Coupe";
  if (raw.includes("sedan") || raw.includes("saloon") || raw.includes("passenger car")) return "Sedan";
  if (raw.includes("hatchback")) return "Hatchback";
  if (raw.includes("convertible")) return "Convertible";
  if (raw.includes("wagon")) return "Wagon";
  return "";
}

export function vehicleTitleFromDecoded(decoded) {
  return (
    [decoded?.year, decoded?.make, decoded?.model, decoded?.trim]
      .filter(Boolean)
      .join(" ")
      .trim() || decoded?.vehicleType || "Vehicle"
  );
}

export function vehicleDescriptionFromDecoded(decoded, vin) {
  const v = (vin || decoded?.vin || "").trim().toUpperCase();
  const d = decoded || {};
  const y = escapeHtml(String(d.year || "").trim());
  const make = escapeHtml(String(d.make || "").trim());
  const model = escapeHtml(String(d.model || "").trim());
  const trim = escapeHtml(String(d.trim || "").trim());
  const driveType = escapeHtml(String(d.driveType || "").trim());
  const vinEsc = escapeHtml(v);
  const vehicleTypeShort = shortVehicleType(d.bodyClass, d.vehicleType);
  const line1Parts = [y, make, model].filter(Boolean).join(" ");
  const dashParts = [trim, vehicleTypeShort].filter(Boolean).join(" ");
  const line1 = [line1Parts, dashParts, driveType, vinEsc].filter(Boolean).join(" - ");
  const parts = [];
  if (line1) parts.push(`<p>${line1}</p>`);
  parts.push("<p>This vehicle is being sold - As Is, Cash Only, Salvage Title, Airbags Deployed</p>");
  parts.push("<p>Call, Text or WhatsApp available 24/7 - 7865782276</p>");
  parts.push("<p>Speedy Motor Group - We are the leader in Damaged &amp; Repairable Vehicles in the USA - We offer Shipping National &amp; Worldwide!</p>");
  parts.push("<p>7103 NW 61st ST, Miami, FL 33166</p>");
  parts.push("<p>📞 7️⃣8️⃣6️⃣5️⃣7️⃣8️⃣2️⃣2️⃣7️⃣6️⃣</p>");
  return parts.join("\n");
}

export function tagsFromDecoded(decoded) {
  const d = decoded || {};
  const tags = [];
  if (d.year) tags.push(String(d.year));
  if (d.make) tags.push(d.make);
  if (d.model) tags.push(d.model);
  if (d.trim) tags.push(d.trim);
  if (d.fuelTypePrimary) tags.push(d.fuelTypePrimary);
  if (d.driveType) tags.push(d.driveType);
  if (d.bodyClass) tags.push(d.bodyClass);
  if (d.vehicleType) tags.push(d.vehicleType);
  return [...new Set(tags)].filter(Boolean).slice(0, 20);
}
