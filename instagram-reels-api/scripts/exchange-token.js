/**
 * Exchange a short-lived token for a long-lived one.
 *
 * Your Reel Sync token from Graph API Explorer is a FACEBOOK token (User/Page).
 * Use the FACEBOOK exchange (needs App ID + App Secret).
 *
 * Usage (PowerShell):
 *   $env:APP_ID = "your_app_id"
 *   $env:APP_SECRET = "your_app_secret"
 *   $env:SHORT_LIVED_TOKEN = "paste_token_here"
 *   node scripts/exchange-token.js
 *
 * Get App ID: Meta for Developers → Reel Sync → Settings → Basic → App ID
 */
const appId = process.env.APP_ID?.trim();
const appSecret = process.env.APP_SECRET?.trim();
const shortLived = process.env.SHORT_LIVED_TOKEN?.trim();

if (!appId || !appSecret || !shortLived) {
  console.error('Set APP_ID, APP_SECRET and SHORT_LIVED_TOKEN.');
  console.error('App ID is in your app: Settings → Basic (numeric).');
  process.exit(1);
}

// Facebook long-lived exchange (for User/Page tokens from Graph API Explorer)
const url = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(shortLived)}`;

async function main() {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (data.access_token) {
    console.log('Long-lived token (copy into Vercel INSTAGRAM_ACCESS_TOKEN):\n');
    console.log(data.access_token);
    if (data.expires_in) console.log('\nExpires in', data.expires_in, 'seconds (~60 days)');
  } else {
    console.error('Exchange failed:', data.error || data);
    process.exit(1);
  }
}

main();
