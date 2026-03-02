# Make the deployment work – step by step

The API is already deployed. Do this so it works end-to-end.

---

## In Vercel

**1. Open the project**  
Go to [vercel.com](https://vercel.com) → your **instagram-reels-api** project.

**2. Add environment variables**  
- **Settings** → **Environment Variables**  
- For each variable: **Key** = name below, **Value** = your value, **Environment** = Production. Save.

| Key | Value |
|-----|--------|
| `INSTAGRAM_ACCESS_TOKEN` | Long-lived Instagram/Page token |
| `INSTAGRAM_USER_ID` | Your Instagram user ID |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` (Supabase → Project Settings → API) |
| `SUPABASE_ANON_KEY` | Supabase anon key (Project Settings → API) |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key (Project Settings → API) |
| `REELS_ADMIN_SECRET` | Any strong secret (e.g. 32 random chars). Copy this – you’ll use the same in the Shopify app |

**3. Redeploy**  
- **Deployments** → open the latest deployment → **⋯** → **Redeploy** → confirm.  
- This applies the new env vars.

**4. Copy the API URL**  
- From the deployment or the project overview: e.g. `https://instagram-reels-api-mu.vercel.app` (no trailing slash).  
- You’ll use this in the next section.

---

## In your Shopify app (Shopify CLI)

**5. Set app env**  
With Shopify CLI, use a **`.env`** file in your **app root** (the `vin-decoder` folder, same folder as `package.json` and `shopify.app.toml`).

1. Open or create: **`vin-decoder\.env`** (if you don’t have one, run `shopify app env pull` first to create it from your linked app).
2. Add these two lines (use your real API URL from step 4 and the same secret as in Vercel):

   ```
   REELS_API_URL=https://instagram-reels-api-mu.vercel.app
   REELS_ADMIN_SECRET=your-same-secret-as-in-vercel
   ```

3. Save the file.
4. **Restart** `shopify app dev` (Ctrl+C, then run it again) so the app loads the new env.

---

## In your theme

**6. Set Reels API URL**  
- **Online Store** → **Themes** → **Customize** → add or open the page with **Shoppable Reels**.  
- In the section settings, set **Reels API URL** to the **full endpoint** (use `https://` and forward slashes):  
  `https://instagram-reels-api-mu.vercel.app/api/reels`  
- Save.

---

## Optional: sync reels on a schedule

**7. Call sync**  
- Manual: open `https://your-api-url.vercel.app/api/sync` in the browser (or use a GET request).  
- Automatic: use [cron-job.org](https://cron-job.org) (or similar) to call `GET https://your-api-url.vercel.app/api/sync` every 6 hours.

---

After steps 1–6, the deployment works: reels can sync, the theme can show them, and the app’s Shoppable Reels page can link products.
