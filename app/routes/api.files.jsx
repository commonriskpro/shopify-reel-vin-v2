/**
 * REMOVED: GET /api/files
 * This endpoint has been migrated to /admin/media?intent=files (admin.media.jsx).
 * All callers now use React Router useFetcher against the admin route, which
 * authenticates via session cookie — no App Bridge token required.
 */
import { gone } from "../lib/api-gone.server.js";
export const loader = gone("/api/files", "/admin/media?intent=files");
export default function ApiFilesGone() { return null; }
