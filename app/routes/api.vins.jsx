/**
 * REMOVED: GET /api/vins
 * Migrated to POST /admin/_index {vin, decodeOnly:true} (admin._index action).
 * The "Decode VIN" button now uses useFetcher.submit against the admin route.
 */
import { gone } from "../lib/api-gone.server.js";
export const loader = gone("/api/vins", "POST /admin with {vin, decodeOnly:true}");
export default function ApiVinsGone() { return null; }
