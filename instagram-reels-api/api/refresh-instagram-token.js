/**
 * GET /api/refresh-instagram-token
 * Refreshes the Instagram long-lived access token and stores it in Supabase.
 * Runs automatically every Sunday 00:00 UTC via Vercel Cron (vercel.json).
 * Vercel sends Authorization: Bearer CRON_SECRET when invoking cron; set CRON_SECRET in Vercel.
 * Requires: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
 * Optional: INSTAGRAM_ACCESS_TOKEN in env as fallback/seed (current long-lived token).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || process.env.REELS_ADMIN_SECRET || '').trim();
const ENV_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN?.trim?.() || process.env.INSTAGRAM_ACCESS_TOKEN;

const CONFIG_KEY = 'instagram_access_token';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (CRON_SECRET) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.secret;
    if (token !== CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let currentToken = (typeof ENV_TOKEN === 'string' ? ENV_TOKEN.trim() : '') || null;
    const { data: row } = await supabase.from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle();
    if (row?.value && typeof row.value === 'string') {
      const stored = row.value.trim();
      if (stored) currentToken = stored;
    }

    if (!currentToken) {
      return res.status(500).json({
        error: 'No token to refresh. Set INSTAGRAM_ACCESS_TOKEN in Vercel (or run sync once after adding it) and redeploy.',
      });
    }

    const refreshUrl = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`;
    const refreshRes = await fetch(refreshUrl);
    const refreshData = await refreshRes.json().catch(() => ({}));

    if (!refreshRes.ok || !refreshData.access_token) {
      const msg = refreshData.error?.message || refreshRes.statusText || 'Refresh failed';
      return res.status(400).json({
        error: 'Instagram token refresh failed',
        detail: msg,
        hint: 'Get a new long-lived token from Meta for Developers and set INSTAGRAM_ACCESS_TOKEN in Vercel, then call this endpoint again.',
      });
    }

    const newToken = refreshData.access_token;
    await supabase.from('app_config').upsert(
      { key: CONFIG_KEY, value: newToken, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    return res.status(200).json({
      ok: true,
      message: 'Token refreshed and saved. Valid for ~60 days. Call this URL weekly.',
    });
  } catch (err) {
    console.error('refresh-instagram-token error:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
