# Step-by-step: Automatic Instagram token refresh

Follow these steps so your Instagram session refreshes automatically and never expires again.

---

## Part 1: Supabase â€“ add the config table

**1.1** Go to [supabase.com](https://supabase.com) and open your project (the one used by the Reels API).

**1.2** In the left sidebar, click **SQL Editor**.

**1.3** If you **already ran** the full `supabase/schema.sql` before (and it included `app_config`), skip to Part 2.

If youâ€™re not sure, or you only created `reels` and `reel_products`, run this in a **New query**:

```sql
-- App config (e.g. Instagram token) - backend only
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
```

**1.4** Click **Run**. You should see â€œSuccess. No rows returned.â€ That creates the `app_config` table.

---

## Part 2: Get a new long-lived token and put it in Vercel

**2.1** Get a **new** token from Meta (Reel Sync uses a **Facebook** User/Page token, not a pure Instagram token):

1. Go to [developers.facebook.com](https://developers.facebook.com) â†’ your app **Reel Sync** â†’ **Tools** â†’ **Graph API Explorer**.
2. Select **Meta App: Reel Sync**, and **User or Page** (User Token is fine if your Page is linked to your Instagram).
3. Under **Permissions**, ensure `instagram_basic` and `pages_show_list` (and any others you need) are listed. The **red X** means â€œnot yet grantedâ€ â€“ you grant them when you generate the token in the next step.
4. Click **Generate Access Token**. Log in / approve so the permissions get the green check. Copy the token (one line, no spaces at start/end).
5. Get your **App ID**: in the same app go to **Settings** â†’ **Basic** â†’ copy the **App ID** (numeric). You need this for the exchange.
6. Exchange the short-lived token for a **long-lived** one using the project script (run from the `instagram-reels-api` folder):

   - In a terminal (PowerShell), from the `instagram-reels-api` folder run (replace **YOUR_APP_ID** with the numeric App ID from Settings â†’ Basic, and paste the token from step 4):

     ```powershell
     $env:APP_ID = "YOUR_APP_ID"
     $env:APP_SECRET = "your_app_secret"
     $env:SHORT_LIVED_TOKEN = "PASTE_THE_TOKEN_FROM_STEP_4_HERE"
     node scripts/exchange-token.js
     ```

     The script uses the **Facebook** long-lived exchange. It will print the long-lived token; copy that single line (no spaces at start/end). Then continue with 2.2 below.

**2.2** Put that token in Vercel:

1. Go to [vercel.com](https://vercel.com) â†’ your **instagram-reels-api** project.
2. **Settings** â†’ **Environment Variables**.
3. Find **`INSTAGRAM_ACCESS_TOKEN`**:
   - If it exists: **Edit** and paste the **new** long-lived token, then save.
   - If it doesnâ€™t exist: **Add** â†’ Key: `INSTAGRAM_ACCESS_TOKEN`, Value: (paste the token), Environment: **Production** â†’ Save.
4. **Important:** When pasting the token, paste into a plain text editor first and remove any spaces or newlines at the start/end, then copy that single line into Vercel. Meta returns â€œCannot parse access tokenâ€ if the token has extra characters.

**2.3** Redeploy so the new token is used:

- **Deployments** â†’ open the latest deployment â†’ **â‹¯** (three dots) â†’ **Redeploy** â†’ confirm.

**2.4** Store the token in Supabase (one-time) so the refresh cron can update it later:

- Open this URL in your browser (use your real Vercel URL and add `?secret=YOUR_CRON_SECRET` if you use `CRON_SECRET`):  
  `https://instagram-reels-api-mu.vercel.app/api/refresh-instagram-token`  
  or, if you use a secret:  
  `https://instagram-reels-api-mu.vercel.app/api/refresh-instagram-token?secret=YOUR_CRON_SECRET`
- You should see a JSON response like `{ "ok": true, "message": "..." }`. That run reads the token from env and saves it into `app_config`. Future refreshes will use the value in `app_config`.

---

## Part 3: Automatic refresh (no extra setup)

The token is refreshed **automatically** by **Vercel Cron**. In `vercel.json` a cron runs every **Sunday 00:00 UTC** and calls `/api/refresh-instagram-token`. Vercel sends `Authorization: Bearer CRON_SECRET` when invoking it.

- **Set `CRON_SECRET`** in Vercel (Project → Settings → Environment Variables, Production) so the cron request is allowed. No external cron service (e.g. cron-job.org) is needed.

---

## Summary

| Part | What it does |
|------|----------------|
| **Part 1** | Creates `app_config` in Supabase so the API can store and update the token. |
| **Part 2** | Puts a new long-lived token in Vercel and runs refresh once so it's saved in `app_config`. |
| **Part 3** | Vercel Cron runs weekly and calls `/api/refresh-instagram-token` so the token is refreshed before it expires. |

After this, you don't need to manually refresh the session; the weekly Vercel cron keeps it valid. If you ever see â€œSession has expiredâ€ again, repeat **Part 2** (new token from Meta â†’ Vercel â†’ redeploy â†’ open the refresh URL once), then the cron will continue from there.

---

## Troubleshooting: â€œInvalid OAuth access token - Cannot parse access tokenâ€ (code 190)

This usually means the token string is invalid or malformed.

1. **Trim the token**
   - In Vercel â†’ **Settings** â†’ **Environment Variables** â†’ **INSTAGRAM_ACCESS_TOKEN** â†’ Edit.
   - Copy the value into Notepad (or any plain text editor). Remove any space or newline at the **beginning** and **end**. Ensure itâ€™s one single line with no line break in the middle.
   - Copy that cleaned value back into Vercel and save.

2. **If itâ€™s stored in Supabase**
   - Supabase â†’ **Table Editor** â†’ **app_config** â†’ find the row with key `instagram_access_token`.
   - Edit the `value`: make sure itâ€™s exactly the token with no leading/trailing spaces or newlines. Save.

3. **Redeploy**
   - Vercel â†’ **Deployments** â†’ latest â†’ **â‹¯** â†’ **Redeploy** so the updated env is used.

4. **Use the correct token type**
   - The refresh endpoint expects an **Instagram** long-lived token (from the `ig_exchange_token` URL in step 2.1). If you only have a **Facebook Page** token, generate an Instagram long-lived token as in 2.1 and use that for `INSTAGRAM_ACCESS_TOKEN`.
