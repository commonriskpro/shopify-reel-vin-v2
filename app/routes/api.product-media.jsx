/**
 * REMOVED: GET/POST /api/product-media (was already deprecated shim)
 * Migrated to /admin/media (admin.media.jsx).
 */
import { gone } from "../lib/api-gone.server.js";
const stub = gone("/api/product-media", "/admin/media");
export const loader = stub;
export const action = stub;
export default function ApiProductMediaGone() { return null; }
