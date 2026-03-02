# Smoke / manual QA checklist

Use this after deploy or before release to verify major features. All /api/* calls must be made from the **embedded admin** (so session token is sent).

---

## 1. Auth & API contract

- [ ] Open the app in Shopify Admin (embedded). No redirect to login when already logged in.
- [ ] In browser DevTools → Network, trigger any /api call (e.g. decode VIN or open Media Picker). Confirm:
  - Request has `Authorization: Bearer <token>`.
  - Response `Content-Type` is `application/json`.
  - Success: body has `ok: true` and `data`.
  - Error: body has `ok: false`, `error.message`, and optionally `meta.requestId`.

---

## 2. VIN decode (admin index)

- [ ] Go to app home (admin index).
- [ ] Enter a valid 17‑character VIN (e.g. `1HGBH41JXMN109186`). Click **Decode**.
- [ ] Decoded vehicle details appear (year, make, model, etc.).
- [ ] Enter an invalid or too-short VIN. Click **Decode**. Error message appears (and optionally request ID).
- [ ] Decode then **Create product**. Draft product is created; link opens in Shopify Admin.

---

## 3. Media picker (add product / add vehicle)

- [ ] Add product or add vehicle flow: open Media Picker (e.g. “Upload new” or “Select existing”).
- [ ] **Upload new:** Choose an image or video file. Upload completes; media appears in the picker and (when product exists) on the product.
- [ ] **Select existing:** File list loads; select a file. It attaches to the product / pending media.
- [ ] Pagination: if “Load more” appears, click it; more files load.
- [ ] Error case: e.g. disconnect network and retry; error message (and optionally request ID) is shown.

---

## 4. Reels (if configured)

- [ ] If REELS_API_URL is set: open Reels page. Reels list loads (or error message if API unreachable).
- [ ] Sync: trigger sync; reels list updates.
- [ ] Toggle “Show reels on homepage” and save; setting persists.

---

## 5. No HTML 502 for API

- [ ] Force an API error (e.g. invalid body or missing auth). Response must be JSON with `ok: false`, not an HTML 502 page.

---

## 6. Security / logging (dev check)

- [ ] Ensure no tokens or `Authorization` headers appear in server logs (check `logServerError` / `sanitizeExtra` usage).
- [ ] Responses do not include stack traces in production.
