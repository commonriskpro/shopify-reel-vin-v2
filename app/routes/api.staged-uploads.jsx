/**
 * REMOVED: POST /api/staged-uploads
 * Migrated to POST /admin/media {intent:"staged-uploads"} (admin.media.jsx).
 */
import { gone } from "../lib/api-gone.server.js";
export const action = gone("/api/staged-uploads", '/admin/media {intent:"staged-uploads"}');
export default function ApiStagedUploadsGone() { return null; }
