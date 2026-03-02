/**
 * REMOVED: GET/POST /api/products/:productId/media
 * Migrated to /admin/media (admin.media.jsx):
 *   GET  ?intent=product-media&productId=gid
 *   POST {intent:"add-product-media", productId, media:[...]}
 */
import { gone } from "../lib/api-gone.server.js";
const stub = gone("/api/products/:productId/media", "/admin/media");
export const loader = stub;
export const action = stub;
export default function ApiProductsMediaGone() { return null; }
