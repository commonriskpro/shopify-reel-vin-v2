/**
 * GET /api/reels - list reels (optional ?homepage=1 to filter)
 * PATCH or POST /api/reels?id=<uuid> - update show_on_homepage (body: { show_on_homepage: boolean }, requires Bearer REELS_ADMIN_SECRET)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REELS_ADMIN_SECRET = process.env.REELS_ADMIN_SECRET;
const VIDEO_DELIVERY_WIDTH = Number(process.env.VIDEO_DELIVERY_WIDTH || 960);

function corsHeaders(origin, methods = 'GET, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  };
}

function auth(req) {
  if (!REELS_ADMIN_SECRET) return false;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token === REELS_ADMIN_SECRET;
}

export default async function handler(req, res) {
  const method = (req.method || '').toUpperCase();
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  const origin = req.headers.origin || '*';
  const isUpdate = method === 'PATCH' || method === 'POST';
  const methods = isUpdate ? 'GET, PATCH, POST, OPTIONS' : 'GET, OPTIONS';
  Object.entries(corsHeaders(origin, methods)).forEach(([k, v]) => res.setHeader(k, v));

  if (method === 'PATCH' || method === 'POST') {
    if (!auth(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const id = req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'Missing id (use ?id=<reel-uuid>)' });
    }
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    const showOnHomepage = body.show_on_homepage;
    if (typeof showOnHomepage !== 'boolean') {
      return res.status(400).json({ error: 'Body must include show_on_homepage (boolean)' });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: 'Server misconfiguration' });
    }
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data, error } = await supabase
        .from('reels')
        .update({ show_on_homepage: showOnHomepage, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, show_on_homepage')
        .single();
      if (error) {
        if (error.code === 'PGRST116') return res.status(404).json({ error: 'Reel not found' });
        console.error('reels PATCH error:', error);
        return res.status(400).json({ error: error.message });
      }
      return res.status(200).json({ ok: true, show_on_homepage: data.show_on_homepage });
    } catch (err) {
      console.error('reels PATCH error:', err);
      return res.status(500).json({ error: String(err.message) });
    }
  }

  if (method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: 'Server misconfiguration: missing Supabase env vars',
      reels: [],
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const {
      buildOptimizedPlaybackUrl,
      buildOptimizedPosterUrl,
      getVideoOptimizerConfig,
    } = await import('./_video-optimize.js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const homepageOnly = req.query.homepage === '1' || req.query.homepage === 'true';
    let query = supabase
      .from('reels')
      .select('id, ig_id, media_url, thumbnail_url, caption, permalink, show_on_homepage, created_at, shopify_video_url, shopify_poster_url, media_sync_status')
      .order('created_at', { ascending: false });
    if (homepageOnly) {
      query = query.eq('show_on_homepage', true);
    }
    const { data: reels, error: reelsError } = await query;

    if (reelsError) {
      console.error('Supabase reels error:', reelsError);
      return res.status(500).json({ error: reelsError.message, reels: [] });
    }

    const { data: reelProducts, error: rpError } = await supabase
      .from('reel_products')
      .select('reel_id, product_handle');

    if (rpError) {
      console.error('Supabase reel_products error:', rpError);
      return res.status(500).json({ error: rpError.message, reels: [] });
    }

    const handleMap = new Map();
    for (const row of reelProducts || []) {
      if (!handleMap.has(row.reel_id)) handleMap.set(row.reel_id, []);
      handleMap.get(row.reel_id).push(row.product_handle);
    }

    const productHandleParam = req.query.product_handle;
    const productHandle = typeof productHandleParam === 'string'
      ? productHandleParam.trim().toLowerCase()
      : '';
    const filterByProduct = Object.prototype.hasOwnProperty.call(req.query, 'product_handle');
    const optimizer = getVideoOptimizerConfig();
    let reelsWithProducts = (reels || []).map((r) => {
      const sourcePlayback = r.shopify_video_url || r.media_url || null;
      const sourcePoster = r.shopify_poster_url || r.thumbnail_url || r.media_url || null;
      const playbackUrl = buildOptimizedPlaybackUrl(sourcePlayback, { width: VIDEO_DELIVERY_WIDTH }) || sourcePlayback;
      const posterUrl = buildOptimizedPosterUrl(sourcePoster, { width: 720 }) || sourcePoster;
      return {
        ...r,
        media_url_original: r.media_url || null,
        thumbnail_url_original: r.thumbnail_url || null,
        playback_url: playbackUrl,
        poster_url: posterUrl,
        optimizer_mode: optimizer.mode,
        media_origin: r.shopify_video_url ? 'shopify' : 'instagram',
        product_handles: handleMap.get(r.id) || [],
      };
    });
    if (filterByProduct) {
      reelsWithProducts = reelsWithProducts.filter(
        (r) => (r.product_handles || []).some((h) => String(h).trim().toLowerCase() === productHandle)
      );
    }

    return res.status(200).json({ reels: reelsWithProducts });
  } catch (err) {
    console.error('reels API error:', err);
    return res.status(500).json({ error: String(err.message), reels: [] });
  }
}
