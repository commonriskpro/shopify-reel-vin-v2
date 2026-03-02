/**
 * REMOVED: POST /api/staged-upload (was already deprecated shim)
 * Migrated to POST /admin/media {intent:"staged-uploads"} (admin.media.jsx).
 */
import { gone } from "../lib/api-gone.server.js";
export const action = gone("/api/staged-upload", '/admin/media {intent:"staged-uploads"}');
export default function ApiStagedUploadGone() { return null; }
