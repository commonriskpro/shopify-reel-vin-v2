/**
 * GET /api/vins?vin=XXX — Decode VIN. Always returns application/json.
 */
import { apiRoute } from "../lib/api.server.js";
import { handleVinDecode } from "../services/vin-decode-handler.server.js";

export const loader = apiRoute(({ request }) => handleVinDecode(request, { scope: "api.vins" }));

export default function ApiVins() {
  return null;
}
