# Supabase project and Vercel environment variables

The app uses a **single Supabase project** for both the main Shopify app (session storage) and the Instagram Reels API (reels data).

## Current Supabase project

- **Project ref:** `ztjxsssrbmftxshidcfq`
- **Dashboard:** https://supabase.com/dashboard/project/ztjxsssrbmftxshidcfq
- **Project URL (API):** `https://ztjxsssrbmftxshidcfq.supabase.co`

Migrations are in the repo root: `supabase/migrations/`. Link and push with:

```bash
npx supabase link --project-ref ztjxsssrbmftxshidcfq
npx supabase db push
```

## Where to get connection values

In the Supabase dashboard for this project:

1. **Project Settings → API**
   - **Project URL** → use for `SUPABASE_URL` (Reels API)
   - **anon public** → `SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_KEY`

2. **Project Settings → Database**
   - **Connection string** (URI): choose **Transaction pooler** (port 6543) for `DATABASE_URL` (main app runtime).
   - **Connection string** (URI): choose **Direct connection** (port 5432) for `DIRECT_URL` (migrations / local dev).
   - Replace `[YOUR-PASSWORD]` with your database password.

## Vercel: Main Shopify app

In the Vercel project for the main app (e.g. **speedy-motor-vin-cloud**):

| Name | Value |
|------|--------|
| `SHOPIFY_API_KEY` | From Shopify Partners or `shopify app env show` |
| `SHOPIFY_API_SECRET` | From Shopify Partners or `shopify app env show` |
| `SCOPES` | e.g. `read_inventory,read_locations,write_inventory,write_products` |
| `SHOPIFY_APP_URL` | `https://speedy-motor-vin-cloud.vercel.app` (or your main app URL) |
| `DATABASE_URL` | Supabase **Transaction pooler** URI (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase **Direct** URI (port 5432) – needed if you run migrations from CI |
| `REELS_API_URL` | Your Reels API base URL (e.g. `https://speedy-motor-reels-api-cloud.vercel.app`) |
| `REELS_ADMIN_SECRET` | Same secret as in the Reels API project |

## Vercel: Instagram Reels API

In the Vercel project for the Reels API (e.g. **speedy-motor-reels-api-cloud**):

| Name | Value |
|------|--------|
| `SUPABASE_URL` | `https://ztjxsssrbmftxshidcfq.supabase.co` |
| `SUPABASE_ANON_KEY` | From Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_KEY` | From Supabase → Settings → API → service_role |
| `INSTAGRAM_ACCESS_TOKEN` | Long-lived Instagram token |
| `INSTAGRAM_USER_ID` | Instagram user ID |
| `CRON_SECRET` | Secret for cron (sync / token refresh) |
| `REELS_ADMIN_SECRET` | Same as main app (for add/remove product links) |
| `SHOPIFY_STORE_DOMAIN` | e.g. `speedy-motor-group.myshopify.com` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Shopify Admin API token (for media mirror) |

After changing env vars in Vercel, **redeploy** the affected project(s).

---

## Shoppable Reels: "Unauthorized" when clicking Import

Import triggers a POST from the main app to its own action, which then calls the Reels API `GET /api/sync` with `Authorization: Bearer <REELS_ADMIN_SECRET>`.

1. **Same secret on both apps**  
   Set `REELS_ADMIN_SECRET` on the **main app** (e.g. speedy-motor-vin-web) and on the **Reels API** (e.g. speedy-motor-reels-api-cloud) to the **exact same value**. The Reels API accepts either `CRON_SECRET` or `REELS_ADMIN_SECRET` for sync; if you use Vercel Cron, set `CRON_SECRET` on the Reels API as well (can be the same value as `REELS_ADMIN_SECRET`).

2. **Main app URL**  
   In the main app’s Vercel env, set `SHOPIFY_APP_URL` to the **actual** app URL (e.g. `https://speedy-motor-vin-web.cloud.vercel.app`). It must match the URL Shopify loads in the admin so the session cookie is valid.

3. **REELS_API_URL**  
   In the main app’s Vercel env, set `REELS_API_URL` to your Reels API base URL with no trailing slash (e.g. `https://speedy-motor-reels-api-cloud.vercel.app`). The app will call `{REELS_API_URL}/api/sync` when you click Import.

4. **Redeploy** both projects after changing env vars.

---

## Theme: storefront reels from the correct API

The **Shoppable Reels** theme section loads reels from the URL set in the theme customizer. To show reels from the current Reels API (and DB):

1. **Online Store → Themes → Customize** → open the page that has the Shoppable Reels section (e.g. Homepage).
2. Select the **Shoppable Reels** section.
3. Set **Reels API URL** to:  
   `https://speedy-motor-reels-api-cloud.vercel.app/api/reels`  
   (full URL including `/api/reels`; no trailing slash after `reels`).
4. **Save**.

New theme installs or new section adds use this URL by default. Existing themes keep their saved URL until you change it in the customizer.
