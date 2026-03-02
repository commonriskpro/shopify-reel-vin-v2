/**
 * Vercel Edge Middleware runs before the serverless function.
 * Return static "first paint" HTML for embedded GET /admin so the iframe is never blank.
 * (Otherwise the app's loaders run first and return 302 to /auth/session-token before entry.server can respond.)
 */
export default function middleware(request) {
  // Temporarily no-op edge middleware to avoid edge-layer 500s.
  // Auth and embedded handling are performed in app server routes.
  return;
}
