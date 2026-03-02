/**
 * GET /api/sync
 * Fetches Reels from Instagram Graph API and upserts into Supabase.
 * Token: read from Supabase app_config first (so refresh can update it), then env INSTAGRAM_ACCESS_TOKEN.
 * Runs automatically via Vercel Cron. Set CRON_SECRET so cron requests are authenticated.
 * Requires: INSTAGRAM_USER_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY; INSTAGRAM_ACCESS_TOKEN (env or in DB).
 *
 * Optional Shopify mirroring:
 * - SHOPIFY_STORE_DOMAIN
 * - SHOPIFY_ADMIN_ACCESS_TOKEN
 * - SHOPIFY_API_VERSION (defaults to 2025-01)
 */

const INSTAGRAM_USER_ID = process.env.INSTAGRAM_USER_ID?.trim?.() || process.env.INSTAGRAM_USER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || process.env.REELS_ADMIN_SECRET || '').trim();
const ENV_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN?.trim?.() || process.env.INSTAGRAM_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN?.trim?.() || process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim?.() || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

const IG_MEDIA_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
const CONFIG_KEY = 'instagram_access_token';
const SHOPIFY_SYNC_ERRORS_KEY = 'shopify_media_last_error';

function normalizeToken(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim().replace(/\s+/g, ' ');
  return s || null;
}

function hasShopifyMediaConfig() {
  return Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_ACCESS_TOKEN);
}

function cleanFileName(name, fallback) {
  const safe = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  return safe || fallback;
}

function extensionFromUrl(url, fallbackExt) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || '';
    const idx = path.lastIndexOf('.');
    if (idx >= 0 && idx < path.length - 1) {
      const ext = path.slice(idx + 1).toLowerCase();
      if (/^[a-z0-9]{2,6}$/.test(ext)) return ext;
    }
  } catch {}
  return fallbackExt;
}

function extractVideoUrl(fileNode) {
  if (!fileNode || typeof fileNode !== 'object') return null;
  if (fileNode.__typename === 'Video') {
    if (Array.isArray(fileNode.sources) && fileNode.sources.length > 0) {
      const mp4 = fileNode.sources.find((s) => (s?.mimeType || '').includes('mp4'));
      return (mp4 && mp4.url) || fileNode.sources[0].url || null;
    }
    return null;
  }
  if (fileNode.__typename === 'GenericFile') return fileNode.url || null;
  return null;
}

function extractPosterUrl(fileNode) {
  if (!fileNode || typeof fileNode !== 'object') return null;
  if (fileNode.__typename === 'MediaImage') return fileNode.image?.url || null;
  if (fileNode.__typename === 'Video') return fileNode.preview?.image?.url || null;
  if (fileNode.__typename === 'GenericFile') return fileNode.url || null;
  return null;
}

async function shopifyGraphql(query, variables) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Shopify API HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(`Shopify GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  return payload?.data;
}

async function uploadVideoToShopifyFromUrl(url, igId) {
  if (!url) return { id: null, url: null, status: null };
  const ext = extensionFromUrl(url, 'mp4');
  const filename = cleanFileName(`reel_${igId}.${ext}`, `reel_${igId}.mp4`);
  const query = `#graphql
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          __typename
          ... on Video {
            id
            status
            sources { url mimeType format }
            preview { image { url } }
          }
          ... on GenericFile {
            id
            url
          }
        }
        userErrors { field message }
      }
    }`;
  const variables = {
    files: [
      {
        originalSource: url,
        contentType: 'VIDEO',
        alt: `Instagram reel ${igId}`,
        filename,
      },
    ],
  };
  const data = await shopifyGraphql(query, variables);
  const result = data?.fileCreate;
  const userErrors = result?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(`Shopify fileCreate video error: ${userErrors.map((e) => e.message).join('; ')}`);
  }
  const node = result?.files?.[0] || null;
  return {
    id: node?.id || null,
    status: node?.status || null,
    url: extractVideoUrl(node),
    previewUrl: extractPosterUrl(node),
  };
}

async function uploadPosterToShopifyFromUrl(url, igId) {
  if (!url) return { id: null, url: null, status: null };
  const ext = extensionFromUrl(url, 'jpg');
  const filename = cleanFileName(`reel_${igId}_poster.${ext}`, `reel_${igId}_poster.jpg`);
  const query = `#graphql
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          __typename
          ... on MediaImage {
            id
            status
            image { url }
          }
          ... on GenericFile {
            id
            url
          }
        }
        userErrors { field message }
      }
    }`;
  const variables = {
    files: [
      {
        originalSource: url,
        contentType: 'IMAGE',
        alt: `Instagram reel poster ${igId}`,
        filename,
      },
    ],
  };
  const data = await shopifyGraphql(query, variables);
  const result = data?.fileCreate;
  const userErrors = result?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(`Shopify fileCreate poster error: ${userErrors.map((e) => e.message).join('; ')}`);
  }
  const node = result?.files?.[0] || null;
  return {
    id: node?.id || null,
    status: node?.status || null,
    url: extractPosterUrl(node),
  };
}

async function getAccessToken(supabase) {
  const { data: row } = await supabase.from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle();
  if (row?.value) {
    const tok = normalizeToken(row.value);
    if (tok) return tok;
  }
  const envTok = normalizeToken(ENV_TOKEN);
  if (envTok) {
    await supabase.from('app_config').upsert(
      { key: CONFIG_KEY, value: envTok, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    return envTok;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REELS_ADMIN_SECRET = (process.env.REELS_ADMIN_SECRET || '').trim();
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.secret;
  const allowedSecrets = [CRON_SECRET, REELS_ADMIN_SECRET].filter(Boolean);
  if (allowedSecrets.length > 0) {
    if (!token || !allowedSecrets.includes(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!INSTAGRAM_USER_ID) {
    return res.status(500).json({
      error: 'Missing INSTAGRAM_USER_ID',
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({
      error: 'Missing Supabase config: set SUPABASE_URL and SUPABASE_SERVICE_KEY',
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const INSTAGRAM_ACCESS_TOKEN = await getAccessToken(supabase);
    if (!INSTAGRAM_ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'Missing Instagram token: set INSTAGRAM_ACCESS_TOKEN in Vercel (or run /api/refresh-instagram-token first)',
      });
    }

    // Use graph.facebook.com for Facebook Login / Page token; graph.instagram.com is for Instagram Login tokens only
    let nextUrl = `https://graph.facebook.com/v18.0/${INSTAGRAM_USER_ID}/media?fields=${IG_MEDIA_FIELDS}&access_token=${encodeURIComponent(INSTAGRAM_ACCESS_TOKEN)}&limit=50`;
    const allMedia = [];

    while (nextUrl) {
      const resp = await fetch(nextUrl);
      if (!resp.ok) {
        const err = await resp.text();
        console.error('Instagram API error:', resp.status, err);
        return res.status(502).json({
          error: 'Instagram API error',
          detail: err.slice(0, 500),
        });
      }
      const data = await resp.json();
      const list = data.data || [];
      allMedia.push(...list);
      nextUrl = data.paging?.next || null;
    }

    const reels = allMedia.filter((m) => m.media_type === 'REELS' || (m.media_type === 'VIDEO' && m.permalink));
    let inserted = 0;
    let updated = 0;
    let mirrored = 0;
    let mirrorErrors = 0;

    for (const reel of reels) {
      const row = {
        ig_id: reel.id,
        media_url: reel.media_url || null,
        thumbnail_url: reel.thumbnail_url || null,
        caption: reel.caption || null,
        permalink: reel.permalink || null,
        created_at: reel.timestamp || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('reels')
        .select('id, media_url, thumbnail_url, shopify_video_url, shopify_poster_url')
        .eq('ig_id', reel.id)
        .maybeSingle();

      let shopifyPatch = {};
      if (hasShopifyMediaConfig() && reel.media_url) {
        const sourceChanged =
          !existing ||
          existing.media_url !== (reel.media_url || null) ||
          existing.thumbnail_url !== (reel.thumbnail_url || null);
        const missingShopifyAssets =
          !existing?.shopify_video_url ||
          !existing?.shopify_poster_url;
        if (sourceChanged || missingShopifyAssets) {
          try {
            const video = await uploadVideoToShopifyFromUrl(reel.media_url, reel.id);
            const posterSource = reel.thumbnail_url || reel.media_url;
            const poster = await uploadPosterToShopifyFromUrl(posterSource, reel.id);
            shopifyPatch = {
              shopify_video_file_id: video.id,
              shopify_video_url: video.url || null,
              shopify_video_status: video.status || null,
              shopify_poster_file_id: poster.id,
              shopify_poster_url: poster.url || video.previewUrl || null,
              shopify_poster_status: poster.status || null,
              media_sync_status: (video.url && (poster.url || video.previewUrl)) ? 'ready' : 'processing',
              media_sync_error: null,
              media_synced_at: new Date().toISOString(),
            };
            mirrored += 1;
          } catch (mirrorErr) {
            mirrorErrors += 1;
            const msg = String(mirrorErr?.message || mirrorErr).slice(0, 500);
            shopifyPatch = {
              media_sync_status: 'failed',
              media_sync_error: msg,
            };
            await supabase
              .from('app_config')
              .upsert({ key: SHOPIFY_SYNC_ERRORS_KEY, value: msg, updated_at: new Date().toISOString() }, { onConflict: 'key' });
          }
        }
      }

      const writeRow = { ...row, ...shopifyPatch };
      if (existing) {
        await supabase.from('reels').update(writeRow).eq('id', existing.id);
        updated += 1;
      } else {
        await supabase.from('reels').insert(writeRow);
        inserted += 1;
      }
    }

    return res.status(200).json({
      ok: true,
      fetched: allMedia.length,
      reels: reels.length,
      inserted,
      updated,
      mirrored,
      mirror_errors: mirrorErrors,
      shopify_media_enabled: hasShopifyMediaConfig(),
    });
  } catch (err) {
    console.error('sync error:', err);
    return res.status(500).json({ error: String(err.message) });
  }
}
