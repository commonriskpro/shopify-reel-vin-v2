/**
 * REMOVED: GET /api/decode-vin (was already deprecated shim for /api/vins)
 * Migrated to POST /admin/_index {vin, decodeOnly:true}.
 */
import { gone } from "../lib/api-gone.server.js";
export const loader = gone("/api/decode-vin", "POST /admin with {vin, decodeOnly:true}");
export default function ApiDecodeVinGone() { return null; }
