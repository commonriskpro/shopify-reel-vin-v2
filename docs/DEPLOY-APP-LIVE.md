# Deploy the app to production (avoid tunnel blocking)

When the app runs behind a **tunnel** (e.g. Cloudflare with `shopify app dev`), some requests can get **405 Method Not Allowed** because the tunnel or App Bridge blocks or alters them. Deploying to a **real host** fixes this.

---

## Best free hosting options

| Host | Free tier | Best for | Note |
|------|-----------|----------|------|
| **Vercel** | Generous free tier | **Recommended** – same place as your Reels API, zero config for React Router | Needs a **hosted database** (see below). This repo is already set up with the Vercel preset. |
| **Render** | 750 hrs/month, app sleeps after 15 min | Easiest if you keep SQLite | Deploy with “Web Service”, build `npm run build`, start `npm run setup && npm run start`. No DB change. |
| **Railway** | $5 credit/month | Simple GitHub deploy | Add env vars, connect repo, deploy. |
| **Fly.io** | Free tier with limits | Full control, Docker | Good if you’re comfortable with CLI and Docker. |

**Yes, you can use Vercel.** This project includes the Vercel React Router preset. The only extra step is adding a **database** (Vercel serverless doesn’t keep SQLite files).

---

## Deploy with Vercel (free, recommended)

### 1. Database (required on Vercel)

Vercel doesn’t keep a persistent filesystem, so you need a **hosted database** instead of SQLite:

- **Vercel Postgres** (in the Vercel dashboard: Storage → Create Database → Postgres) – free tier available, and you get a `POSTGRES_URL` (or `DATABASE_URL`) env var.
- Or **Neon** (neon.tech) – free tier, then add `DATABASE_URL` in Vercel.

Then point Prisma at it:

1. In `prisma/schema.prisma`, change the datasource to:

   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. For **local dev**, either:
   - Use a local Postgres and set `DATABASE_URL` in `.env`, or
   - Keep a separate `schema.prisma` / branch for production (Postgres) vs dev (SQLite) if you prefer.

3. Run migrations (after you have `DATABASE_URL`):

   ```bash
   npx prisma migrate deploy
   ```

   You may need to create an initial migration for Postgres (e.g. `npx prisma migrate dev --name init_postgres`) and then use that in production.

### 2. Deploy to Vercel

1. Push the repo to GitHub (if you haven’t already).
2. In [Vercel](https://vercel.com), **Import** the repo and create a project (root directory = repo root).
3. Add **Environment Variables** (Settings → Environment Variables):

   | Name | Value |
   |------|--------|
   | `SHOPIFY_APP_URL` | `https://your-project.vercel.app` (replace with your real Vercel URL after first deploy) |
   | `SHOPIFY_API_KEY` | From `shopify app env show` |
   | `SHOPIFY_API_SECRET` | From `shopify app env show` |
   | `SCOPES` | From `shopify app env show` |
   | `DATABASE_URL` | From Vercel Postgres or Neon |
   | `REELS_API_URL` | Your Reels API base (e.g. `https://instagram-reels-api-xxx.vercel.app`) |
   | `REELS_ADMIN_SECRET` | Same as in your Reels API project |

4. Deploy. Vercel will use the existing **Vercel React Router preset** in `react-router.config.js`.
5. After the first deploy, set `SHOPIFY_APP_URL` to your real Vercel URL (e.g. `https://vin-decoder-xxx.vercel.app`) and redeploy.

### 3. Point Shopify at the app URL

1. In `shopify.app.toml` set:
   - `application_url` = your Vercel URL (e.g. `https://vin-decoder-xxx.vercel.app`)
   - `[auth]` → `redirect_urls` = `https://vin-decoder-xxx.vercel.app/api/auth`
2. Run:

   ```bash
   shopify app deploy
   ```

### 4. Use the app from your live store

In Shopify Admin (your live store), open your app from **Apps**. The app loads from your Vercel URL; no tunnel, so the 405 issue goes away.

---

## Deploy with Render (free, keep SQLite)

1. [Render](https://render.com) → New → **Web Service**, connect your repo.
2. **Build command:** `npm install && npm run build`
3. **Start command:** `npm run setup && npm run start`
4. Add env vars (same as in the table above; use your Render URL for `SHOPIFY_APP_URL`). No `DATABASE_URL` needed if you keep SQLite (note: free tier disk can be ephemeral, so sessions may be lost on restart).
5. Deploy, then set `application_url` in `shopify.app.toml` to your Render URL and run `shopify app deploy`.

---

## Summary

- **Best free option:** **Vercel** – free tier, same ecosystem as your Reels API, React Router already configured. You only need to add a hosted Postgres (Vercel Postgres or Neon) and point Prisma at it.
- **Easiest no-DB-change option:** **Render** – free tier, keep SQLite and current Prisma setup; app may sleep after 15 minutes on free tier.

After deployment, use the app from your **live store** so all traffic hits your deployed URL and the tunnel no longer affects requests.
