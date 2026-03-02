# Step 1 — Spec: DMS-Level Hardening (NO CODE)

**Status:** Spec only. Implementation starts only after approval.

**Scope:** Shopify VIN Decoder app (React Router + Admin + extensions). Goal: resource-only API, Option A architecture, Zod at the edge, fixed envelope, central GraphQL wrapper, single VIN source, deterministic behavior, env validation, no secret leakage, tests.

---

## 1. Current Route Map

### 1.1 API routes (all under app, authenticated via `authenticate.admin`)

| Route | Methods | Purpose | Issues |
|-------|---------|---------|--------|
| `/api/decode-vin` | GET | Decode VIN via query `?vin=`. Returns `{ decoded, raw }` or `{ error }`. | **Verb in path.** No fixed envelope. No Zod on query. |
| `/api/files` | GET | Paginated shop files for media picker. Query: `first`, `after`. Returns `{ nodes, pageInfo }` or `{ error }` in 200 body. | **GraphQL in route.** No service. No Zod. Inconsistent: errors sometimes 200 + error key. |
| `/api/staged-upload` | POST | Create staged upload targets. Body: `{ files: [{ filename, mimeType, fileSize? }] }`. Returns `{ stagedTargets }` or `{ error }`. | **Verb in path.** **GraphQL in route.** No service. No Zod. No envelope. |
| `/api/product-media` | GET, POST | GET: list product media by `?productId=`. POST: add media to product. Body: `{ productId, media: [...] }`. | **GraphQL in route.** No service. No Zod. No envelope. Mixed resource (product sub-resource). |

### 1.2 Admin UI routes

| Route | Loader | Action | Issues |
|-------|--------|--------|--------|
| `admin` (layout) | `authenticate.admin`, `ensureVinDecoderMetafieldDefinitions(admin.graphql)` | — | GraphQL called in layout loader (metafields bootstrap). |
| `admin._index` | Session only | Decode-only (via `/api/decode-vin` from client) or decode+create product via `createProductFromVin(admin.graphql, …)`. | Action has business logic + service call; no Zod on body. |
| `admin.add-product` | **Taxonomy:** `admin.graphql` (categories) directly in loader. | Decode-only (decodeVin + builders in route) or create via `createProductFull(admin.graphql, …)`. Body parsed manually, no Zod. | **Loader calls GraphQL directly.** Action has decode + mapping in route. |
| `admin.add-vehicle` | Session only | Decode-only or decode+create via `decodeVin` + `createProductFromVin(admin.graphql, …)`. | No Zod on body. |
| `admin.reels` | `getShowReelsOnHomepage(admin.graphql)` + external `fetchJsonWithPolicy(REELS_API_URL/api/reels)`. | `setShowReelsOnHomepage(admin.graphql)`, sync, set_homepage, add/remove product via external API. | Loader reads env in route; GraphQL via metafields.server (OK). Action has multiple intents, no Zod on form. |
| `admin.reels.set-homepage` | 405 | POST: validate reel_id, call external API to set show_on_homepage. | Resource route; validation via security.server (OK). No envelope. |
| `admin.additional` | (not scanned in detail) | — | — |

### 1.3 Auth and webhooks

- **Auth:** `auth.login`, `auth.$.jsx` (Shopify OAuth).
- **Webhooks:** `webhooks.app.uninstalled`, `webhooks.app.scopes_update` — use `authenticate.webhook(request)`. No HMAC/body verification beyond Shopify’s auth.

---

## 2. Proposed Route Map (Resource-Only for /api)

### 2.1 API routes (resource-oriented, fixed envelope)

| Current | Proposed | Methods | Resource semantics |
|---------|-----------|---------|---------------------|
| `/api/decode-vin` | **`/api/vins`** | GET | Decode: `GET /api/vins?vin=XXX`. Single resource “VIN decode result” for a given VIN. |
| `/api/files` | **`/api/files`** | GET | List shop files: `GET /api/files?first=30&after=cursor`. Already resource; keep path. |
| `/api/staged-upload` | **`/api/uploads/staged`** or **`/api/staged-uploads`** | POST | Create staged upload targets: `POST /api/staged-uploads` with body `{ files: [...] }`. Resource = “staged uploads” collection. |
| `/api/product-media` | **`/api/products/:productId/media`** | GET, POST | GET list media; POST add media. Sub-resource of product. |

**Recommendation:**

- **`/api/vins`** — GET with `?vin=` for decode (and optional future: list decode history if we add DB later).
- **`/api/files`** — keep.
- **`/api/staged-uploads`** — POST to create (resource name = staged uploads).
- **`/api/products/:productId/media`** — GET/POST for product media.

**Migration:** Add new routes; keep old routes as thin wrappers that redirect or call the same service and return envelope, then deprecate old paths (or remove in one go if no external clients).

### 2.2 Admin UI routes (no path changes required)

- Paths stay: `/admin`, `/admin/add-product`, `/admin/add-vehicle`, `/admin/reels`, `/admin/reels/set-homepage`, `/admin/additional`.
- **Behavior change:** All loaders/actions must stop calling `admin.graphql` directly. They call **services only**; services use the **central GraphQL wrapper**.

---

## 3. Service Layer Structure

### 3.1 Location and naming

- **Directory:** `app/services/*.server.js` (or `.ts` if migrating to TypeScript).
- **Naming:** One module per domain; functions are the public API.

### 3.2 Proposed services

| Service module | Responsibility | Used by |
|----------------|----------------|--------|
| **`vin.service.server.js`** | `decodeVin(vin)`, `normalizeVin`, `isValidVin` (re-export or delegate to single source). Builders: `vehicleTitleFromDecoded`, `vehicleDescriptionFromDecoded`, `tagsFromDecoded`. No GraphQL. | API vins route, add-product, add-vehicle, _index. |
| **`product.service.server.js`** | `createProductFromVin(graphqlWrapper, options)`, `createProductFull(graphqlWrapper, options)`. All product/create and variant/metafield/inventory logic. Calls **GraphQL wrapper** only. | admin.add-product, admin.add-vehicle, admin._index. |
| **`category.service.server.js`** | `getCategoriesForVehicles(graphqlWrapper)` — taxonomy categories (Vehicles first, then fallback). Returns `{ categories, defaultCategoryId }`. | admin.add-product loader. |
| **`files.service.server.js`** | `listShopFiles(graphqlWrapper, { first, after })` — run files query, normalize to `{ nodes, pageInfo }`. | API files route. |
| **`staged-uploads.service.server.js`** | `createStagedUploads(graphqlWrapper, { files })` — build input, run mutation, return `{ stagedTargets }`. | API staged-uploads route. |
| **`product-media.service.server.js`** | `getProductMedia(graphqlWrapper, productId)`, `addProductMedia(graphqlWrapper, productId, media)`. | API product-media route. |
| **`metafields.service.server.js`** | Move from `metafields.server.js`: `ensureVinDecoderMetafieldDefinitions`, `getShowReelsOnHomepage`, `setShowReelsOnHomepage`. All take GraphQL wrapper. | admin loader, admin.reels. |
| **`reels-external.service.server.js`** (optional) | `fetchReelsList(baseUrl, secret)`, `syncReels(baseUrl, secret)`, `setReelShowOnHomepage(baseUrl, secret, reelId, show)`, `addReelProduct`, `removeReelProduct`. Encapsulate REELS_API_URL + REELS_ADMIN_SECRET (from validated env). | admin.reels loader/action. |

### 3.3 Flow (Option A)

- **UI route (loader/action):**
  - Parse params, query, body.
  - **Zod validate** (params, query, body) → on failure return **fixed error envelope**.
  - Call **one or more services** (e.g. `decodeVin`, `createProductFull`, `getCategoriesForVehicles`).
  - No `admin.graphql` in route; no raw GraphQL strings in route.
- **Service:**
  - Receives validated inputs and the **GraphQL wrapper** (not raw `admin.graphql`).
  - Contains all business logic and calls only the wrapper.
- **GraphQL wrapper:**
  - Single entry point: `app/lib/shopify-graphql.server.js`.
  - Normalizes HTTP errors, GraphQL top-level `errors`, and `userErrors` into a **structured internal result or thrown error** (typed for the app: e.g. `{ userErrors }` or throw with `code`/`source`).
  - No raw `response.json()` in services; wrapper returns parsed, normalized shape.

---

## 4. Fixed Response Envelope (All /api Routes)

Every `/api/*` response must be one of:

```ts
// Success
type ApiOk<T> = {
  ok: true;
  data: T;
  meta?: { requestId: string; warnings?: ApiWarning[] };
};

// Error
type ApiErr = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    fieldErrors?: Record<string, string[]>;
    retryable?: boolean;
    source?: "VALIDATION" | "SHOPIFY" | "VPIC" | "DB" | "INTERNAL";
  };
  meta?: { requestId: string };
};

type ApiResponse<T> = ApiOk<T> | ApiErr;
```

- **Success:** `200` with `{ ok: true, data: T, meta? }`. Optional `meta.warnings` for non-fatal issues (e.g. “inventory not set”).
- **Client error (validation, bad request):** `400` with `ApiErr`; `error.source` can be `VALIDATION`; include `fieldErrors` when applicable.
- **Not found:** `404` with `ApiErr` (e.g. no decode results for VIN).
- **Rate limit:** `429` with `ApiErr` + `Retry-After` header; `error.retryable: true`.
- **Server/upstream error:** `502` (or 500) with `ApiErr`; `error.source` (VPIC, SHOPIFY, INTERNAL), `error.retryable` where applicable.
- **requestId:** Add to `meta` for all responses (from header `X-Request-ID` or generate UUID) for support/debug; **no session/token in meta**.

---

## 5. Error Taxonomy

| source | Meaning | Typical HTTP | retryable |
|--------|---------|--------------|-----------|
| VALIDATION | Zod or business validation failed | 400 | false |
| SHOPIFY | GraphQL userErrors or API error | 400/502 | per case |
| VPIC | NHTSA VPIC unreachable or no result | 502/404 | true for 502 |
| DB | Prisma/DB error | 502 | true |
| INTERNAL | Unexpected app error | 500 | false |

- **Structured only:** No raw `throw` to client. Catch in route or wrapper and return `ApiErr`.
- **Logging:** Use safe logger (no tokens, no session id in logs). `logServerError(context, err, { requestId, shop: redacted? })` — do not log `session.id` or tokens.

---

## 6. Determinism Policy

- **No silent “best effort”** for critical operations:
  - **Product create:** Either the product (and optionally variant + metafields) is created and reported in `data`, or the request fails with `ApiErr`. If inventory/location fails, either:
    - **A) Hard fail:** Return 502 and do not create product, or
    - **B) Success with warnings:** Return 200, `ok: true`, `data: { product, productId }`, and `meta.warnings: [{ code: "INVENTORY_NOT_SET", message: "..." }]`.
  - **Spec decision:** Prefer **B** for “add product” flows so the merchant gets the product; document that warnings must be surfaced in UI (Step 3).
- **VIN decode:** Decode either returns data or fails (404/502). No partial decode.
- **Staged uploads / product media:** Same: full success or structured error; no silent partial success.
- **Reels (external API):** On sync/list failure, return error; do not return 200 with empty list and hidden error (current loader sometimes returns `reels: []` with `error` in payload — normalize to envelope).

---

## 7. Logging Policy

- **Safe logger:** No `session.id`, no access tokens, no API secrets in logs. Safe to log: requestId, shop domain (or hashed), route name, error message, non-sensitive payload flags.
- **Structured:** Prefer one log line per request/error with a small JSON or key-value set (e.g. `[context] message key=value`).
- **Levels:** Error for failures; info/debug only for operational diagnostics; no `console.log` of user/session data.
- **VIN:** Logging “VIN decode requested” is OK for audit; do not log full VIN in error payloads if policy says so (spec: allow last 4 or “VIN…XXXX” only if needed).

---

## 8. Single Source of Truth for VIN

- **Location:** `app/lib/vin.server.js` (or under `app/services/vin.service.server.js`).
- **Exports:**
  - `normalizeVin(raw) → string` (trim, uppercase).
  - `isValidVin(vin) → boolean` (regex: e.g. `^[A-HJ-NPR-Z0-9]{8,17}$` — same as current `security.server.js`).
  - `decodeVin(vin)` → calls NHTSA, returns `{ decoded, raw }`; **must** use `normalizeVin` and `isValidVin` before calling VPIC (or validate at edge and pass normalized VIN).
- **Usage:**
  - All app routes and services use this module for validation and decode.
  - **Extension:** Extension runs in Admin UI (browser); it currently has its own VPIC call and no shared code. Options:
    - **A)** Document the **contract** (same regex, same length 8–17) and have extension call **`GET /api/vins?vin=XXX`** when running inside the app (embedded) so decode is server-side single source; or
    - **B)** Keep extension calling VPIC directly but document that `normalizeVin`/`isValidVin` logic must match (e.g. same regex in extension code or a tiny shared snippet).
  - **Spec choice:** Prefer **A** for embedded usage (single source = app API); document **B** for parity if extension is used outside app frame.
- **security.server.js:** Keep rate limiting and other helpers; **VIN** normalize/validate either re-export from `vin.server.js` or delete and use only `vin.server.js` everywhere.

---

## 9. Env Validation (Fail Fast)

- **File:** `app/env.server.js`.
- **Behavior:** On first import (e.g. in root or admin layout), run Zod schema that validates:
  - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL` (required for app).
  - Optional: `REELS_API_URL`, `REELS_ADMIN_SECRET` (for reels features); `SHOP_CUSTOM_DOMAIN`.
- **Missing required env:** Throw immediately so the app does not start in a bad state.
- **No defaulting of secrets:** Do not default `API_SECRET` to `""` in production; fail if missing.

---

## 10. Central Shopify GraphQL Wrapper

- **File:** `app/lib/shopify-graphql.server.js`.
- **API:** e.g. `runGraphQL(graphql, { query, variables })`:
  - Calls `graphql(query, { variables })`.
  - Reads `response.json()`.
  - If top-level `errors`: normalize to internal error (message, code) and **throw** (or return `{ ok: false, errors }` — spec: throw so services can catch and map to ApiErr).
  - If `userErrors` on mutation/query result: throw or return structured so services can map to 400 + fieldErrors.
  - On HTTP failure: throw with source SHOPIFY, retryable if 5xx/429.
- **All Shopify calls** from services go through this wrapper; no direct `admin.graphql` in services.

---

## 11. Acceptance Checklist (Step 1 — Spec)

Before moving to Step 2 (Backend), confirm:

- [ ] **Routes:** Agreement on resource-only API map: `/api/vins`, `/api/files`, `/api/staged-uploads`, `/api/products/:productId/media`.
- [ ] **Migration:** Decision on deprecation of `/api/decode-vin`, `/api/staged-upload`, `/api/product-media` (redirect vs. remove).
- [ ] **Services:** Agreement on service list and that no UI route calls `admin.graphql` directly.
- [ ] **Envelope:** All `/api` responses use `ApiOk`/`ApiErr` with `requestId` and no secrets.
- [ ] **Determinism:** Product create: success + optional `meta.warnings` for inventory; no silent ignore.
- [ ] **VIN:** Single source in `app/lib/vin.server.js` (or vin.service); extension either calls `/api/vins` or matches contract.
- [ ] **Env:** Fail-fast Zod validation in `app/env.server.js`.
- [ ] **Logging:** Safe logger; no tokens/session id in logs.
- [ ] **Tests:** Unit tests for VIN normalize/validate, decode mapping, tag/title/metafield builders; integration tests for GraphQL wrapper and API envelope (planned in Step 2).

---

## 12. Summary Table

| Rule | Current state | Target |
|------|----------------|--------|
| Routes = resources | `/api/decode-vin`, `/api/staged-upload`, etc. | `/api/vins`, `/api/files`, `/api/staged-uploads`, `/api/products/:id/media` |
| No GraphQL in UI routes | Loaders/actions call `admin.graphql` | Only services; services use wrapper |
| Zod at edge | None | Every loader/action validates params, query, body |
| Fixed envelope | Ad-hoc `{ error }`, `{ decoded, raw }` | `ApiOk` / `ApiErr` with requestId, source, fieldErrors |
| Central GraphQL | Direct `graphql()` in routes/services | `app/lib/shopify-graphql.server.js` |
| Single VIN source | security.server + vin-decode.server + extension duplicate | `app/lib/vin.server.js`; extension uses API or same contract |
| Determinism | Silent ignore of inventory/location | Fail or success + meta.warnings |
| Env validation | Ad-hoc process.env | `app/env.server.js` Zod, fail fast |
| No secret leakage | logServerError(..., { shop }) | Safe logger; no session/token in logs |
| Tests | None | Unit (VIN, builders); integration (wrapper, envelope) |

---

**End of Step 1 Spec.** Do not begin implementation until this spec is approved.
