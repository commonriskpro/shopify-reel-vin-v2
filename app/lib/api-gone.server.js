/**
 * Helper for 410 Gone stubs. Returns a loader/action that always responds with
 * HTTP 410 and a JSON envelope pointing clients to the replacement.
 * Used for retired /api/* endpoints that have been moved to /admin/* routes.
 */
import { makeRequestId } from "./api-envelope.js";

/**
 * @param {string} oldPath - The path that was removed.
 * @param {string} replacement - Description of the replacement.
 * @returns {(args: { request: Request }) => Response}
 */
export function gone(oldPath, replacement) {
  return ({ request }) => {
    const requestId = makeRequestId(request);
    return Response.json(
      {
        ok: false,
        error: {
          message: `${oldPath} has been removed. Use ${replacement} instead.`,
          code: "GONE",
        },
        meta: { requestId },
      },
      {
        status: 410,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      }
    );
  };
}
