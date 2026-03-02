# Release checklist – VIN Decoder app

Use this checklist before production releases and for onboarding.

---

## Required env vars and example .env

Main app (Shopify admin). Set where the app runs (e.g. Vercel or local `.env`):

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_API_KEY` | Yes | Shopify app Client ID |
| `SHOPIFY_API_SECRET` | Yes | Shopify app Client secret |
| `SCOPES` | Yes | Comma-separated scopes (match `shopify.app.toml`) |
| `SHOPIFY_APP_URL` | Yes | Full app URL, no trailing slash |
| `DATABASE_URL` | Yes | PostgreSQL (pooler, e.g. port 6543 with `?pgbouncer=true`) |
| `DIRECT_URL` | Yes | Direct Postgres for migrations (port 5432) |
| `REELS_API_URL` | No | Base URL of Reels API (Shoppable Reels) |
| `REELS_ADMIN_SECRET` | No | Secret for Reels API; set same in Reels project |
| `SHOP_CUSTOM_DOMAIN` | No | Custom shop domain if not `*.myshopify.com` |

Example `.env` (do not commit secrets):

```env
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret
SCOPES=read_inventory,read_locations,write_inventory,write_products
SHOPIFY_APP_URL=https://your-app.vercel.app
DATABASE_URL=postgresql://...?pgbouncer=true
DIRECT_URL=postgresql://...:5432/...
```

---

## Local dev steps

1. Clone repo, install deps: `npm install`
2. Copy `.env.example` to `.env` and fill in Shopify + DB vars
3. Generate Prisma client and run migrations: `npx prisma generate && npx prisma migrate deploy`
4. Start dev: `npm run dev` (runs `shopify app dev`; tunnel and auth handled by CLI)
5. Open the app URL shown in the terminal and complete OAuth in a dev store

---

## Test steps

- **Unit / integration:** `npm test` (Vitest). Must pass before release.
- **Option A enforcement:** `npm run check:option-a` (fails if `admin.graphql` appears outside `app/lib/shopify-graphql.server.*` and `app/services/*`).
- **Lint:** `npm run lint` (if configured).
- **Typecheck:** `npm run typecheck` (if configured).

---

## Manual smoke checklist

Run through in a dev store after deploy or before release:

- [ ] **Decode success:** Admin → VIN Decoder → enter valid 17-char VIN → Decode VIN → decoded vehicle details appear.
- [ ] **Invalid VIN:** Enter invalid or unknown VIN → Decode VIN → error banner with message and Request ID (copyable).
- [ ] **Create product success + warnings:** Create a product (e.g. “Decode and add to store” or Add vehicle) → if backend returns warnings (e.g. inventory), single “Completed with warnings” banner with bullet list appears.
- [ ] **Staged upload + attach media:** Add product (or edit existing) → MediaPicker → Upload new → choose file → media attaches; no 413 for normal file size.
- [ ] **Select existing file:** MediaPicker → Select existing → pick from Files → attaches to product (or adds to pending if no product yet).
- [ ] **Reels toggle (if applicable):** Admin → Reels → toggle “Show reels on homepage” and confirm it persists.
- [ ] **Extension decode:** Product page → VIN Decoder action (if installed) → decode uses `/api/vins` (no shim `/api/decode-vin` in new UI).

---

## Known limitations

- **In-memory rate limiting:** Rate limits (e.g. VIN decode, create draft) are in-memory per process. In multi-instance deployments, limits are per instance, not global. For strict global limits, use a shared store (e.g. Redis) in a future iteration.
- **Body size:** JSON POST to `/api/*` is capped at 100 KB (Content-Length). Larger payloads return 413 with envelope.
- **Deprecated shims:** `/api/decode-vin`, `/api/staged-upload`, `/api/product-media` remain working but are deprecated; prefer `/api/vins`, `/api/staged-uploads`, `/api/products/:productId/media`.

---

## Rollback plan notes

- **Code rollback:** Redeploy previous deployment (e.g. Vercel “Promote to Production” from a prior deployment, or git revert + redeploy).
- **Database:** Prisma migrations are forward-only; rollback may require a new migration to reverse schema changes. Session table is critical; avoid dropping or renaming without a backup.
- **Env vars:** Keep a copy of last-known-good env (e.g. in password manager or secure doc); avoid changing `SHOPIFY_APP_URL` and `DATABASE_URL` during an incident.
- **Secrets:** If `SHOPIFY_API_SECRET` or DB URL was rotated, update env and restart; no code change needed.
