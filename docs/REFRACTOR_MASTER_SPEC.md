# Full Project Refactor — Master Spec

Shopify embedded Remix app on Vercel. This document defines the target architecture, contracts, and migration plan. No code in this doc — implementation follows in Steps 2–4.

---

## 1. System Map (Repo-Wide Inventory)

### 1.1 Auth / Session

- **Entry:** `app/shopify.server.js` — `shopifyApp()`, exports `authenticate`, `login`, `addDocumentResponseHeaders`.
- **Flow:** Embedded admin requests carry session token (App Bridge). `authenticate.admin(request)` validates token; can throw or return `Response` (redirect) when missing/invalid.
- **Centralized auth for /api:** `app/lib/api.server.js` — `requireAdmin(request)` wraps `authenticate.admin`, never redirects; throws `ApiError(401)` so all /api routes return 401 JSON.

### 1.2 API Routes (JSON-returning under /api)

| Route Module | Method | Purpose | Auth | Status |
|--------------|--------|---------|------|--------|
| `api.files.jsx` | GET | List shop files (media picker) | requireAdmin | Canonical |
| `api.staged-uploads.jsx` | POST | Create staged upload targets | requireAdmin | Canonical |
| `api.staged-upload.jsx` | POST | Same as staged-uploads | requireAdmin | Deprecated shim |
| `api.products.$productId.media.jsx` | GET, POST | List/add product media | requireAdmin | Canonical |
| `api.product-media.jsx` | GET, POST | Same by ?productId= / body | requireAdmin | Deprecated shim |
| `api.vins.jsx` | GET | Decode VIN (VPIC) | requireAdmin + rate limit | Canonical |
| `api.decode-vin.jsx` | GET | Same as /api/vins | requireAdmin + rate limit | Deprecated shim |

All must use `apiRoute`, `requireAdmin` where needed, Zod validation, and unified envelope.

### 1.3 Non-API Routes (Loaders/Actions That Return JSON or Affect API Contract)

- **admin._index.jsx** — Loader returns `{ shop }`. Action: POST form (create draft, decode VIN); returns JSON (error/ok). Not under /api but returns JSON; should use consistent envelope for action.
- **admin.add-product.jsx** — Loader + action; action returns product/envelope.
- **admin.add-vehicle.jsx** — Fetcher submits to same app action.
- **admin.reels.jsx** — Loader fetches external REELS_API_URL (not app /api). Action: form intents (sync, add/remove product, set homepage); returns JSON.
- **admin.reels.set-homepage.jsx** — Loader/action; calls external API and app.
- **admin.jsx** — Loader: authenticate.admin, return apiKey. No JSON API.
- **auth.$.jsx**, **auth.login/** — Auth/bounce; not /api.
- **webhooks.*** — Webhook handlers; not /api.

Only routes under `app/routes/api.*` are required to use the strict “always JSON, no redirect” contract. Admin actions may keep existing JSON shape but should avoid leaking HTML/redirect.

### 1.4 Services Layer (Server-Side Shopify / External)

| Service | Purpose | Throws / Returns |
|---------|---------|------------------|
| `files.server.js` | listFiles(admin, { first, after }) → { items, pageInfo } | Normalized items |
| `staged-uploads.server.js` | createStagedUploads(admin, { files }) | ApiError(400) on userErrors |
| `product-media.server.js` | getProductMedia, attachMediaToProduct | ApiError(404/400) |
| `vins.server.js` | decodeVin, normalizeVin, isValidVin | Used by api.vins |
| `products.server.js` | createProductFromVin, etc. | Used by admin actions |
| `metafields.server.js` | getShowReelsOnHomepage, setShowReelsOnHomepage | Used by admin.reels |
| `categories.server.js` | Category helpers | Used by admin |
| (External) | REELS_API_URL (instagram-reels-api) | fetchJsonWithPolicy from admin.reels |

All Shopify GraphQL via `app/lib/shopify-graphql.server.js` (runGraphQL, runGraphQLWithUserErrors). User errors from mutations → ApiError(400) in services.

### 1.5 UI Components & Network Callers

| Location | What | Target |
|----------|------|--------|
| **MediaPicker.jsx** | apiFetchAuthed (uses useAuthenticatedFetch), authFetch for /api/files | /api/staged-uploads, /api/products/:id/media, /api/files |
| **admin._index.jsx** | apiFetch(DECODE_API) — DECODE_API = "/api/vins" | /api/vins |
| **admin.add-vehicle.jsx** | useFetcher().submit (form to route action) | Same-origin action |
| **admin.add-product.jsx** | useFetcher (decode, create product) | Same-origin action |
| **admin.reels.jsx** | useFetcher for form intents; server loader uses fetchJsonWithPolicy(REELS_API_URL) | External Reels API; not app /api |

Critical fix: **admin._index** uses `apiFetch` (plain fetch) for `/api/vins` → must use authenticated fetch so session token is sent.

### 1.6 Shared Utilities

- **app/lib/api.server.js** — ApiError, requireAdmin, jsonOk, jsonFail, apiRoute. (Add parseJsonBody with size guard.)
- **app/lib/api-envelope.js** — makeRequestId, rejectIfBodyTooLarge, ok/err (legacy), zodErrorToFieldErrors.
- **app/lib/api-client.js** — apiFetch (plain fetch + envelope parse), getWarnings. Used by admin._index for decode; should be replaced by authenticated client for /api.
- **app/hooks/useAuthenticatedFetch.js** — Returns fetch that adds Bearer session token (CDN App Bridge). Used by MediaPicker.
- **app/http.server.js** — logServerError (sanitizeExtra for secrets), fetchJsonWithPolicy (external calls).
- **app/security.server.js** — enforceRateLimit, VIN/handle/reel ID validation.

---

## 2. Contract Standards (Non-Negotiable)

### 2.1 API Response Contract

- **All /api/* responses:** `Content-Type: application/json`. Never HTML. Never redirect.
- **Success:** `{ ok: true, data: T, meta?: { requestId?: string, warnings?: [...] } }`.
- **Error:** `{ ok: false, error: { message: string, code?: string, details?: unknown }, meta?: { requestId?: string } }`.
- Every response includes or can include `requestId` (from header or generated).

### 2.2 Auth Contract

- **Backend:** `requireAdmin(request)` from api.server.js. Calls `authenticate.admin(request)`. If result is `Response` or `session?.shop` missing → throw `ApiError(401)`. Never redirect for /api.
- **Frontend:** All requests to app’s /api/* use the Remix template authenticated fetch (useAuthenticatedFetch). No raw fetch for /api. No useFetcher().load("/api/...") for data that requires auth.

### 2.3 Validation Contract

- Zod at the edge for query, body, params.
- Method enforcement: 405 JSON for wrong method.
- Body size: enforce max (e.g. 100KB) for POST; 413 JSON when exceeded.
- requestId on every error response.

### 2.4 Shopify API Correctness

- stagedUploadsCreate: resource `IMAGE` | `VIDEO` (not PRODUCT_VIDEO); fileSize string (UnsignedInt64).
- userErrors / mediaUserErrors from GraphQL → map to 400 JSON with details.

### 2.5 UI Contract

- All UI consumers parse the unified envelope (ok, data, error, meta.requestId).
- Show actionable errors: message + requestId (e.g. in toast or banner).

---

## 3. Canonical Structure / Folder Plan

```
app/
  lib/
    api.server.js     # ApiError, makeRequestId, parseJsonBody (size guard), jsonOk, jsonFail, requireAdmin, apiRoute
    api-envelope.js   # rejectIfBodyTooLarge, zodErrorToFieldErrors (keep for route use)
    api.client.js     # NEW: unified client using useAuthenticatedFetch; apiGet(url), apiPost(url, body); envelope parse; content-type check
    api-client.js     # RENAME or ALIAS: keep getWarnings; apiFetch can become wrapper around authenticated client for /api
    shopify-graphql.server.js
    vin.server.js     # (if exists)
  hooks/
    useAuthenticatedFetch.js  # Session token fetch for /api
  services/
    *.server.js       # Only Shopify Admin API (and external) calls; normalized outputs; throw ApiError on userErrors
  routes/
    api.*.jsx         # Thin: validate (Zod), requireAdmin, call services, jsonOk/jsonFail; all wrapped in apiRoute
  components/
    MediaPicker.jsx   # Use api.client.js (authenticated apiGet/apiPost) only
```

- **api.server.js:** Single source of truth for route helpers. Add `parseJsonBody(request, { maxBytes })` returning parsed body or throwing ApiError(400/413).
- **api.client.js (new name or separate file):** Provides `apiGet`, `apiPost` that use `useAuthenticatedFetch` and enforce JSON + envelope. Used by all UI that calls /api.
- **api-client.js (existing):** Either deprecated for /api calls and replaced by api.client.js, or refactored so apiFetch uses authenticated fetch when calling /api and keeps envelope parsing + getWarnings.

---

## 4. Migration Plan

1. **Duplicate / legacy endpoints:** Keep as deprecated shims; implementation delegates to same services.
   - api.staged-upload.jsx → same logic as api.staged-uploads.jsx.
   - api.decode-vin.jsx → same as api.vins.jsx.
   - api.product-media.jsx → same as api.products.$productId.media.jsx.
2. **Components calling /api:** MediaPicker already uses useAuthenticatedFetch + local apiFetchAuthed. Migrate to single api.client.js (apiGet/apiPost) so one place enforces JSON and envelope. admin._index decode: switch from apiFetch to authenticated apiGet("/api/vins?vin=...").
3. **Admin actions (non-/api):** Keep current behavior; optionally align action JSON to { ok, data/error, requestId } where easy. Not required for this refactor.
4. **External API (REELS_API_URL):** No change; server-side fetchJsonWithPolicy only.

---

## 5. Test & QA Plan

### 5.1 Contract Tests

- **Enumerate /api routes:** From spec §1.2 (api.files, api.staged-uploads, api.staged-upload, api.products.$productId.media, api.product-media, api.vins, api.decode-vin).
- **For each:** Assert that for a request (with or without auth):
  - Response Content-Type is application/json.
  - Body is valid JSON and has shape { ok, data? | error?, meta? }.
  - Unauthorized (no/invalid token) → 401 with JSON envelope.
- **No 502 HTML:** Ensure apiRoute catches all errors and returns JSON (no uncaught exception → Vercel HTML 502).

### 5.2 Integration / Smoke

- **Media flow:** Upload new (staged upload → direct upload → attach media); Select existing (files list → attach). Both require authenticated /api calls.
- **VIN decode:** Admin index decode button calls /api/vins with auth; returns decoded data or error with requestId.
- **Smoke checklist:** docs/SMOKE.md with manual steps for each major feature.

### 5.3 Logging & Secrecy

- No tokens, cookies, or Authorization headers in logs (sanitizeExtra in logServerError).
- requestId in logs and in response meta.
- Production: do not attach stack traces to response details.

---

## 6. Execution Order

1. **Step 1 (this doc):** Spec complete.
2. **Step 2:** Backend — api.server.js (add parseJsonBody), ensure all api.* routes use apiRoute + requireAdmin + Zod + jsonOk/jsonFail; services throw ApiError.
3. **Step 3:** Frontend — api.client.js (useAuthenticatedFetch + apiGet/apiPost + envelope); replace all /api callers (MediaPicker, admin._index) to use it; ensure content-type and error handling.
4. **Step 4:** Security & QA — contract tests for /api routes; SMOKE.md; verify logging and no secrets in responses.

---

## 7. Implementation status

- **Backend:** api.server.js has parseJsonBody, makeRequestId re-export; all api.* routes use apiRoute, requireAdmin, jsonOk/jsonFail, parseJsonBody where applicable. api.vins and api.decode-vin use shared handleVinDecode.
- **Frontend:** app/lib/api.client.js provides useApiClient() (apiGet, apiPost) and formatApiError. MediaPicker and admin._index use it for all /api calls.
- **Tests:** tests/api-contract.test.js asserts 401 + application/json for api.vins, api.files, api.staged-uploads. tests/api-vins-envelope.test.js updated for unified envelope.
- **QA:** docs/SMOKE.md lists manual steps for auth, VIN decode, media picker, reels, and no-HTML-502.
- **Logging:** logServerError uses sanitizeExtra (SENSITIVE_KEYS); no stack traces in API response body.
