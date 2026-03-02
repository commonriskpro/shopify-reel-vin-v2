# Vercel setup for main Shopify app

Add environment variables in your **main app** Vercel project (e.g. **speedy-motor-vin-cloud**), then deploy.

## 1. Add environment variables in Vercel

1. Open your main app project in Vercel → **Settings** → **Environment Variables**.
2. Add the following (for **Production**, **Preview**, and **Development** as needed):

| Name | Value | Notes |
|------|--------|--------|
| `DATABASE_URL` | Supabase **pooler** URI (port 6543) | From [Supabase project](https://supabase.com/dashboard/project/ztjxsssrbmftxshidcfq) → Settings → Database → Connection string → **Transaction pooler**. Add `?pgbouncer=true` if not present. |
| `DIRECT_URL` | Supabase **direct** URI (port 5432) | Same project → Database → **Direct connection**. Required for local `prisma migrate deploy`; optional in Vercel if you don’t run migrations there. |
| `SHOPIFY_API_KEY` | From `shopify app env show` | Same as `client_id` in shopify.app.toml |
| `SHOPIFY_API_SECRET` | From `shopify app env show` | Keep secret |
| `SCOPES` | From `shopify app env show` | e.g. `read_inventory,read_locations,write_inventory,write_products` |
| `SHOPIFY_APP_URL` | `https://speedy-motor-vin-cloud.vercel.app` | Your actual main app URL (no trailing slash). |
| `REELS_API_URL` | Your Reels API base URL | e.g. `https://speedy-motor-reels-api-cloud.vercel.app` |
| `REELS_ADMIN_SECRET` | Same as in Reels API project | For Shoppable Reels add/remove and homepage toggle |

3. Save each variable.

**Full list and Reels API env:** see [SUPABASE-AND-VERCEL-ENV.md](SUPABASE-AND-VERCEL-ENV.md).

## 2. Deploy

- **Option A:** Push to the connected GitHub repo; Vercel will build and deploy automatically.
- **Option B:** From the project root run: `npx vercel --prod` (deploys from local source).

After the first deploy, set `SHOPIFY_APP_URL` to the deployed URL (e.g. `https://vin-decoder-xxx.vercel.app`) in Vercel env vars and redeploy.

## 3. Point Shopify at the Vercel app

1. In `shopify.app.toml` set:
   - `application_url` = your Vercel URL (e.g. `https://vin-decoder-xxx.vercel.app`)
   - `[auth]` → `redirect_urls` = `https://vin-decoder-xxx.vercel.app/api/auth`
2. Run: `shopify app deploy`

## 4. Test the app (no tunnel)

1. In **Shopify Admin** (your store), open **Apps** → your app.
2. Go to **Shoppable Reels** and toggle **Show on homepage** on a reel.
3. Requests go to the Vercel app URL (no tunnel), so the previous "Method Not Allowed" (405) should be resolved.

## Supabase: Session table for the app

The app uses the **same Supabase project** as the Reels API: **ztjxsssrbmftxshidcfq**. Session table `Session` and reels tables are in that project. Use the **pooled** connection string (port **6543**) in Vercel for serverless; use **direct** (port **5432**) for local `prisma migrate deploy`. See [SUPABASE-AND-VERCEL-ENV.md](SUPABASE-AND-VERCEL-ENV.md).
