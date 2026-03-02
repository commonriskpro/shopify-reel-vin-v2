/**
 * DEPRECATED: use /api/vins. Thin shim: GET /api/decode-vin?vin=XXX → same as GET /api/vins?vin=XXX. Unified envelope.
 */
import { apiRoute } from "../lib/api.server.js";
import { handleVinDecode } from "./api.vins.jsx";

export const loader = apiRoute(({ request }) => handleVinDecode(request, { scope: "api.decode-vin" }));

export default function ApiDecodeVin() {
  return null;
}
