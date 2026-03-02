# Instagram Reels API (Vercel)

Serverless API that syncs Instagram Reels to Supabase and serves them for the Shopify shoppable-reels section. Deploy to Vercel for $0 (free tier).

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reels` | GET | Returns all reels with `product_handles` for the theme. CORS allowed for any origin. |
| `/api/sync` | GET | Fetches Reels from Instagram and upserts into Supabase. **Runs automatically every 6 hours** via Vercel Cron. Token is read from Supabase (or env on first run). |
| `/api/refresh-instagram-token` | GET | Refreshes the long-lived Instagram token and saves it in Supabase. **Runs automatically every Sunday 00:00 UTC** via Vercel Cron so the token never expires. |
| `/api/reel-products` | POST | Add product to reel. Body: `{ "reel_id": "uuid", "product_handle": "handle" }`. Requires `REELS_ADMIN_SECRET`. |
| `/api/reel-products` | DELETE | Remove product from reel. Query: `?reel_id=uuid&product_handle=handle`. Requires `REELS_ADMIN_SECRET`. |

## Setup

### 1. Supabase

Use the **same Supabase project** as the main Shopify app (Session + reels live in one DB). Current project: **ztjxsssrbmftxshidcfq** — [Dashboard](https://supabase.com/dashboard/project/ztjxsssrbmftxshidcfq). Migrations are in the repo root `supabase/migrations/`; run `npx supabase db push` from the repo root after linking.

1. In **Project Settings → API**: copy **Project URL** (`SUPABASE_URL` = `https://ztjxsssrbmftxshidcfq.supabase.co`), **anon public** (`SUPABASE_ANON_KEY`), and **service_role** (`SUPABASE_SERVICE_KEY`). Never expose the service key in the storefront.

### 2. Instagram

1. Create an app at [developers.facebook.com](https://developers.facebook.com) and add **Instagram Graph API**.
2. Connect your **Instagram Business or Creator** account to a **Facebook Page**.
3. Get a **long-lived** Page/Instagram token and your **Instagram User ID** (e.g. from Graph API Explorer: `me?fields=id` while authenticated as the Page).
4. Required env: `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`.

### 3. Vercel

**→ For a manual step-by-step in the Vercel dashboard, see [VERCEL-STEPS.md](VERCEL-STEPS.md).**

1. Push this folder to a repo or deploy with **Vercel CLI**: `cd instagram-reels-api && vercel`.
2. In **Project Settings → Environment Variables**, add:

   | Name | Value | Notes |
   |-----|--------|------|
   | `INSTAGRAM_ACCESS_TOKEN` | (long-lived token) | Required for sync |
   | `INSTAGRAM_USER_ID` | (Instagram user id) | Required for sync |
   | `SUPABASE_URL` | `https://ztjxsssrbmftxshidcfq.supabase.co` (same as main app) | Required |
   | `SUPABASE_ANON_KEY` | (anon key) | Required for `/api/reels` |
   | `SUPABASE_SERVICE_KEY` | (service_role key) | Required for `/api/sync` |
   | `CRON_SECRET` | **(recommended)** | **Required for Vercel Cron:** Vercel sends `Authorization: Bearer CRON_SECRET` when invoking cron. Also use for manual calls: `?secret=<CRON_SECRET>` or `Authorization: Bearer <CRON_SECRET>`. |
   | `REELS_ADMIN_SECRET` | (optional) | If set, `/api/reel-products` (add/remove product links) requires `Authorization: Bearer <REELS_ADMIN_SECRET>`. Use the same value in your Shopify app env so the in-app “Shoppable Reels” UI can manage links. |
   | `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` | Required to mirror reel media to Shopify CDN files. |
   | `SHOPIFY_ADMIN_ACCESS_TOKEN` | (Admin API token) | Required to upload reels/posters to Shopify files/media. |
   | `SHOPIFY_API_VERSION` | `2025-01` | Optional API version for Shopify GraphQL calls. |

3. Redeploy. **Sync and token refresh run automatically** via Vercel Cron (see below). Set `CRON_SECRET` in Vercel so cron requests are authenticated.

### Automatic schedule (Vercel Cron)

`vercel.json` defines two crons that run on **production** only. No external cron service needed.

| Path | Schedule | Description |
|------|----------|-------------|
| `/api/sync` | Every 6 hours (`0 */6 * * *`) | Syncs Reels from Instagram to Supabase. |
| `/api/refresh-instagram-token` | Every Sunday 00:00 UTC (`0 0 * * 0`) | Refreshes the long-lived token and saves it in Supabase so it never expires. |

Vercel sends `Authorization: Bearer CRON_SECRET` when invoking these endpoints. **Set `CRON_SECRET`** in Vercel Environment Variables (Production) so the cron requests are allowed.

**Manual runs (optional):** Call `GET https://your-app.vercel.app/api/sync` or `GET https://your-app.vercel.app/api/refresh-instagram-token` with `?secret=YOUR_CRON_SECRET` or header `Authorization: Bearer YOUR_CRON_SECRET`. After a token expiry, get a new long-lived token from Meta, set `INSTAGRAM_ACCESS_TOKEN` in Vercel, redeploy, then call the refresh URL once; the weekly cron will keep it refreshed.



### 4. Linking products to reels

In Supabase **Table Editor → reel_products**, add rows:

- `reel_id`: UUID from `reels.id`
- `product_handle`: Shopify product handle (e.g. `my-product` from `/products/my-product`)

The shoppable section will show these products under each reel.

## Local development

```bash
cd instagram-reels-api
npm install
cp .env.example .env
# Fill .env with real values
npx vercel dev
```

- Reels: `http://localhost:3000/api/reels`
- Sync: `http://localhost:3000/api/sync`

## Theme section

In the Shopify theme, add the **Shoppable Reels** section and set **Reels API URL** to `https://your-vercel-app.vercel.app/api/reels`.
