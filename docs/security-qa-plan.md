# Security & QA Plan — Step 4

**Project:** Shopify App (React Router / Node + Shopify Admin API)  
**Goal:** Harden for production, eliminate security gaps, add QA coverage.

---

## 1) Route inventory

| Route / Endpoint | Method | Auth | Classification | Inputs | Notes |
|------------------|--------|------|----------------|--------|--------|
| `/` | GET | None | Public | — | Index; redirects / login |
| `/auth/login` | GET/POST | None | Public | query: shop | Shopify OAuth entry |
| `/auth/*` | GET | None | Public | varies | Shopify OAuth callbacks |
| `/admin` | GET | Session | Admin | — | Layout loader; sync metafields |
| `/admin/add-product` | GET/POST | Admin | Admin | body (JSON) | Zod + body limit + rate limit (decode) |
| `/admin/_index` | GET/POST | Admin | Admin | body (JSON) | Zod + rate limit |
| `/admin/setup` | GET/POST | Admin | Admin | — | POST creates definitions; no rate limit |
| `/admin/sync-metafields` | GET | Admin | Admin | query: list | Loader only; fetcher used for list |
| `/admin/reels` | GET/POST | Admin | Admin | formData | Rate limit; intent + reel_id validated |
| `/admin/reels/set-homepage` | GET/POST | Admin | Admin | — | Auth only |
| `/admin/media` | GET/POST | Admin | Admin | query (intent, first, after, productId); body (JSON) | Zod; no body size limit on POST |
| `/api/decode-vin` | GET | — | Gone | — | 410 stub |
| `/api/vins` | GET | — | Gone | — | 410 stub |
| `/api/files` | GET | — | Gone | — | 410 stub |
| `/api/staged-upload(s)` | POST | — | Gone | — | 410 stub |
| `/api/products/:productId/media` | GET/POST | — | Stub | — | Returns 501 |
| `/api/product-media` | GET/POST | — | Stub | — | Returns 501 |
| `/webhooks/app/uninstalled` | POST | Webhook HMAC | Webhook | body | authenticate.webhook (HMAC by library) |
| `/webhooks/app/scopes_update` | POST | Webhook HMAC | Webhook | body | authenticate.webhook; no idempotency |

**Trust boundaries:** User input (all admin forms, query, body), Shopify OAuth callbacks, Shopify webhooks (HMAC-signed), staged upload URLs (from Shopify), Admin API responses.

---

## 2) Findings and fixes mapping

| # | Finding | Risk | Fix |
|---|--------|------|-----|
| F1 | Webhooks: no idempotency; duplicates can run multiple times | Medium | Store `X-Shopify-Webhook-Id` (or event id) with TTL; skip if already processed |
| F2 | Logs may contain sensitive keys | Low | Extend redaction in http.server.js (cookie, Cookie, x-shopify-*, bearer, etc.) |
| F3 | admin.media POST: no body size limit before request.json() | Medium | Enforce max body size (e.g. 2MB) and Content-Type application/json for POST |
| F4 | admin.setup POST: no rate limit | Low | Add rate limit for POST (create definitions) |
| F5 | admin.add-product / admin._index POST: no Content-Type check | Low | Reject POST with non-JSON content-type where JSON is required |
| F6 | Error responses: ensure no stack traces in production | Low | Already using logServerError + jsonFail; confirm no .stack in client payloads |
| F7 | Security documentation missing | Low | Add SECURITY.md (env vars, protections, operational notes) |

**Already in place:** Admin routes use `authenticate.admin`; API pattern uses `requireAdmin` + `parseJsonBody` with size limit; admin.add-product and admin._index use Zod and rate limits; entry.server sets CSP and frame-ancestors; webhooks use `authenticate.webhook` (HMAC verified by Shopify library).

---

## 3) Checklist of tests added

- [x] Unit: `security.server.js` — `enforceRateLimit` in `tests/security-webhook-guards.test.js`; `normalizeVin`/`isValidVin` in `tests/vin.test.js`
- [x] Unit: `api-envelope` — `rejectIfBodyTooLarge`, `makeRequestId`, `err`/`ok` in `tests/api-envelope.test.js`
- [x] Webhook idempotency: `getWebhookId`, `hasProcessedWebhookId`, `markWebhookIdProcessed` in `tests/security-webhook-guards.test.js`
- [x] Request guards: `requireJsonPost` (415 for non-JSON, 413 for oversized) in `tests/security-webhook-guards.test.js`
- [ ] Route: admin route 401 when auth fails (covered by existing app flow; no dedicated test to avoid mocking auth)
- [ ] Abuse: 413/415 covered by unit tests for `requireJsonPost`; full route abuse tests optional

---

## 4) Rollout notes

- Deploy after tests pass and lint/typecheck pass.
- Webhook idempotency uses in-memory store (LRU with TTL); for multi-instance deployments consider Redis or DB-backed store later.
- Env vars required for production: see SECURITY.md. No new env vars introduced by this plan.

---

## 5) Implementation status

| Fix | Status |
|-----|--------|
| F1 Webhook idempotency | Implemented |
| F2 Redaction layer | Implemented |
| F3 admin.media body limit + Content-Type | Implemented |
| F4 admin.setup rate limit | Implemented |
| F5 Content-Type check (add-product, _index) | Implemented |
| F6 No stack in prod | Verified (no .stack in jsonFail) |
| F7 SECURITY.md | Implemented |
| Tests + quality gates | Implemented |

**Quality gates:** `npm run test` (53 tests), `npm run typecheck`, and `npm run build` (NODE_ENV=production) pass. Lint (`npm run lint`) has a pre-existing ESLint/ajv config error in the repo, unrelated to these changes.
