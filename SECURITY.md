# Security

This document describes security protections, required environment variables, and operational notes for the Shopify VIN Decoder app.

## Protections

- **Authentication:** All `/admin/*` routes require a valid Shopify admin session (`authenticate.admin`). API-style routes use `requireAdmin()` and return 401 JSON (no redirect) on failure.
- **Webhooks:** `/webhooks/*` use Shopify’s `authenticate.webhook(request)`, which verifies HMAC. Handlers are idempotent: duplicate webhook events (same `X-Shopify-Webhook-Id` / `X-Shopify-Event-Id`) are skipped and return 200.
- **Input validation:** Admin actions that accept JSON validate with Zod at the boundary. Query params and route params are validated where used.
- **Body limits:** POST bodies are limited (e.g. 2MB for add-product and media) to prevent abuse. Requests exceeding the limit receive 413.
- **Content-Type:** POST routes that expect JSON require `Content-Type: application/json` and return 415 otherwise.
- **Rate limiting:** Sensitive actions (VIN decode, product create, setup definitions, reels, media) are rate-limited per shop and IP.
- **Logging:** Server logs redact sensitive keys (tokens, cookies, authorization headers, HMAC headers). No PII or secrets are logged.
- **Errors:** Production responses do not include stack traces. Errors are logged server-side with request IDs; clients receive generic messages and optional `requestId` for support.
- **CSP / embedding:** The app sets Content-Security-Policy (frame-ancestors) and removes X-Frame-Options for embedded admin so only Shopify admin can embed the app.

## Environment variables

- **SHOPIFY_API_KEY** / **SHOPIFY_API_SECRET:** Required for OAuth and webhook HMAC. Keep secret out of client and logs.
- **SCOPES:** Comma-separated Shopify API scopes (e.g. `read_products,write_products,read_publications,write_publications`).
- **SHOPIFY_APP_URL:** Full app URL (e.g. `https://your-app.vercel.app`). Used for OAuth and redirects.
- **DATABASE_URL** / **DIRECT_URL:** Prisma database URLs. Session and webhook idempotency state (in-memory) do not store secrets in DB beyond session tokens (handled by Prisma/session storage).
- **REELS_API_URL** / **REELS_ADMIN_SECRET:** Optional; used for Shoppable Reels. If set, use a strong secret and keep it server-only.

Do not commit `.env` or expose API secret, DB URL, or admin secrets in client bundles or logs.

## Operational notes

- Webhook idempotency is in-memory (LRU with TTL). For multi-instance deployments, consider a shared store (e.g. Redis) for webhook ids.
- Rate limits are in-memory per process. For multi-instance, consider a shared rate limiter.
- Keep dependencies updated and run `npm audit` and tests before releases.

## Reporting vulnerabilities

Please report security issues privately to the maintainers (e.g. via repository contact or your normal channel). Do not open public issues for sensitive findings.
