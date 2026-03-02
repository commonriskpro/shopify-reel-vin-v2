/**
 * POST: add product to reel. Body: { reel_id, product_handle }
 * DELETE: remove product from reel. Body or query: reel_id, product_handle
 * Requires: REELS_ADMIN_SECRET in header Authorization: Bearer <secret> or ?secret=<secret>
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REELS_ADMIN_SECRET = process.env.REELS_ADMIN_SECRET;

function auth(req) {
  if (!REELS_ADMIN_SECRET) return true;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.secret;
  return token === REELS_ADMIN_SECRET;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!auth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  let reelId, productHandle;
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : req.body || {};
    reelId = body.reel_id;
    productHandle = body.product_handle;
  } else {
    reelId = req.query.reel_id;
    productHandle = req.query.product_handle;
  }

  if (!reelId || !productHandle || typeof productHandle !== 'string') {
    return res.status(400).json({ error: 'Missing reel_id or product_handle' });
  }

  const handle = String(productHandle).trim().toLowerCase().replace(/^\/products\/?/, '').replace(/\/$/, '') || null;
  if (!handle) {
    return res.status(400).json({ error: 'Invalid product_handle' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (req.method === 'POST') {
      const { error } = await supabase.from('reel_products').insert({
        reel_id: reelId,
        product_handle: handle,
        sort_order: 0,
      });
      if (error) {
        if (error.code === '23505') return res.status(200).json({ ok: true, message: 'Already linked' });
        return res.status(400).json({ error: error.message });
      }
      return res.status(200).json({ ok: true });
    }

    const { error } = await supabase.from('reel_products').delete().eq('reel_id', reelId).eq('product_handle', handle);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('reel-products error:', err);
    return res.status(500).json({ error: String(err.message) });
  }
}
