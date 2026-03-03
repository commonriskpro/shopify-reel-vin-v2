import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { LRUCache } from "lru-cache";
import { authenticate } from "../shopify.server";
import { fetchJsonWithPolicy, logServerError } from "../http.server.js";
import { getShowReelsOnHomepage, setShowReelsOnHomepage } from "../services/metafields.server.js";
import {
  enforceRateLimit,
  isValidProductHandle,
  isValidReelId,
  normalizeProductHandle,
  normalizeReelId,
} from "../security.server.js";
import "../styles/admin.reels.css";

let REELS_API_URL = (process.env.REELS_API_URL || "").trim().replace(/\/api\/reels\/?$/i, "") || "";
const REELS_ADMIN_SECRET = process.env.REELS_ADMIN_SECRET || "";
const reelsReadCache = new LRUCache({ max: 50, ttl: 15_000 });

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let showReelsOnHomepage = true;
  try {
    showReelsOnHomepage = await getShowReelsOnHomepage(admin);
  } catch (_) {}
  if (!REELS_API_URL) {
    return { reels: [], reelsApiUrl: null, configured: false, showReelsOnHomepage };
  }
  const cacheKey = `reels:${session?.shop || "unknown"}`;
  const cached = reelsReadCache.get(cacheKey);
  if (cached) {
    return { ...cached, showReelsOnHomepage };
  }
  try {
    const url = `${REELS_API_URL.replace(/\/$/, "")}/api/reels`;
    const api = await fetchJsonWithPolicy(url, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
      retries: 1,
      timeoutMs: 9000,
    });
    if (!api.ok) {
      return {
        reels: [],
        reelsApiUrl: REELS_API_URL,
        configured: true,
        error: "Could not load reels right now.",
        showReelsOnHomepage,
      };
    }
    const payload = {
      reels: api.data?.reels || [],
      reelsApiUrl: REELS_API_URL,
      configured: true,
      showReelsOnHomepage,
    };
    reelsReadCache.set(cacheKey, payload);
    return payload;
  } catch (err) {
    logServerError("admin.reels.loader", err, { shop: session?.shop });
    return { reels: [], reelsApiUrl: REELS_API_URL, configured: true, error: "Could not load reels.", showReelsOnHomepage };
  }
};

export const action = async ({ request }) => {
  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  const form = await request.formData();
  const intent = form.get("intent");
  const limited = enforceRateLimit(request, {
    scope: "admin.reels.action",
    limit: 30,
    windowMs: 60_000,
    keyParts: [session?.shop || "unknown", String(intent || "")],
  });
  if (!limited.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  if (intent === "toggle_reels_on_homepage") {
    const show = form.get("show_reels_on_homepage") === "true";
    const result = await setShowReelsOnHomepage(admin, show);
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
    reelsReadCache.delete(`reels:${session?.shop || "unknown"}`);
    return Response.json({ ok: true, show_reels_on_homepage: show });
  }

  if (intent === "sync_reels") {
    if (!REELS_API_URL) {
      return Response.json({ ok: false, error: "Missing REELS_API_URL" }, { status: 500 });
    }
    try {
      const base = REELS_API_URL.replace(/\/$/, "");
      const authHeader = REELS_ADMIN_SECRET ? { Authorization: `Bearer ${REELS_ADMIN_SECRET}` } : {};
      const api = await fetchJsonWithPolicy(`${base}/api/sync`, {
        method: "GET",
        headers: { Accept: "application/json", ...authHeader },
        retries: 1,
        timeoutMs: 12_000,
      });
      const data = api.data || {};
      if (!api.ok) {
        const message =
          api.status === 401
            ? "Reels API returned Unauthorized. Set REELS_ADMIN_SECRET to the same value on both the main app and the Reels API (Vercel env), then redeploy."
            : data?.error || data?.message || "Sync failed.";
        return Response.json(
          { ok: false, error: message },
          { status: api.status === 401 ? 401 : api.status >= 400 ? api.status : 502 }
        );
      }
      reelsReadCache.delete(`reels:${session?.shop || "unknown"}`);
      let reelsToReturn = data?.reels ?? [];
      const reelsApi = await fetchJsonWithPolicy(`${base}/api/reels`, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
        retries: 1,
        timeoutMs: 5000,
      });
      if (reelsApi.ok && Array.isArray(reelsApi.data?.reels)) {
        reelsToReturn = reelsApi.data.reels;
      }
      return Response.json({ ok: true, synced: true, inserted: data?.inserted ?? 0, reels: reelsToReturn });
    } catch (err) {
      logServerError("admin.reels.sync", err, { shop: session?.shop });
      return Response.json({ ok: false, error: `Sync request failed: ${err.message}` }, { status: 502 });
    }
  }

  if (!REELS_API_URL || !REELS_ADMIN_SECRET) {
    return Response.json({ error: "Reels API not configured (REELS_API_URL, REELS_ADMIN_SECRET)" }, { status: 500 });
  }
  const reelId = normalizeReelId(form.get("reel_id"));
  const base = REELS_API_URL.replace(/\/$/, "");
  const authHeader = REELS_ADMIN_SECRET ? { Authorization: `Bearer ${REELS_ADMIN_SECRET}` } : {};

  if (intent === "set_homepage") {
    const showOnHomepage = form.get("show_on_homepage") === "true";
    if (!isValidReelId(reelId)) return Response.json({ ok: false, error: "Invalid reel_id" }, { status: 400 });
    try {
      const api = await fetchJsonWithPolicy(`${base}/api/reels?id=${encodeURIComponent(reelId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ show_on_homepage: showOnHomepage }),
        retries: 1,
        timeoutMs: 9000,
      });
      const data = api.data || {};
      if (!api.ok) {
        const message = data?.error || data?.message || "Reels API request failed.";
        return Response.json({ ok: false, error: message }, { status: api.status >= 400 ? api.status : 502 });
      }
      reelsReadCache.delete(`reels:${session?.shop || "unknown"}`);
      return Response.json({ ok: true, show_on_homepage: data.show_on_homepage === true });
    } catch (err) {
      logServerError("admin.reels.set_homepage", err, { shop: session?.shop, reelId });
      return Response.json({ ok: false, error: `Reels API request failed: ${err.message}` }, { status: 502 });
    }
  }

  const productHandle = normalizeProductHandle(form.get("product_handle"));
  if (!isValidReelId(reelId) || !isValidProductHandle(productHandle)) {
    return Response.json({ error: "Missing reel_id or product_handle" }, { status: 400 });
  }
  if (intent === "add") {
    try {
      const api = await fetchJsonWithPolicy(`${base}/api/reel-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ reel_id: reelId, product_handle: productHandle }),
        retries: 1,
        timeoutMs: 9000,
      });
      const data = api.data || {};
      if (!api.ok) return Response.json(data, { status: api.status });
      reelsReadCache.delete(`reels:${session?.shop || "unknown"}`);
      return Response.json(data);
    } catch (err) {
      logServerError("admin.reels.add_product", err, { shop: session?.shop, reelId });
      return Response.json({ error: "Reels API request failed." }, { status: 502 });
    }
  }
  if (intent === "remove") {
    try {
      const api = await fetchJsonWithPolicy(
        `${base}/api/reel-products?reel_id=${encodeURIComponent(reelId)}&product_handle=${encodeURIComponent(productHandle)}`,
        { method: "DELETE", headers: authHeader, retries: 1, timeoutMs: 9000 }
      );
      const data = api.data || {};
      if (!api.ok) return Response.json(data, { status: api.status });
      reelsReadCache.delete(`reels:${session?.shop || "unknown"}`);
      return Response.json(data);
    } catch (err) {
      logServerError("admin.reels.remove_product", err, { shop: session?.shop, reelId });
      return Response.json({ error: "Reels API request failed." }, { status: 502 });
    }
  }
  return Response.json({ error: "Invalid intent" }, { status: 400 });
};

function ReelCard({ reel, shopify, onActionSuccess }) {
  const fetcher = useFetcher();
  const homepageFetcher = useFetcher();
  const productHandles = reel.product_handles || [];
  const isBusy = fetcher.state === "submitting" || fetcher.state === "loading";
  const isHomepageBusy = homepageFetcher.state === "submitting" || homepageFetcher.state === "loading";
  const [newHandle, setNewHandle] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const justAdded = fetcher.state === "idle" && fetcher.data?.ok && fetcher.formData?.get("reel_id") === reel.id && fetcher.formData?.get("intent") === "add";
  const isSetHomepageForThisReel = homepageFetcher.formData?.get("intent") === "set_homepage" && homepageFetcher.formData?.get("reel_id") === reel.id;
  const homepageError = isSetHomepageForThisReel && homepageFetcher.data && !homepageFetcher.data.ok && homepageFetcher.data.error;
  const showOnHomepage = reel.show_on_homepage === true;
  const [optimisticHomepage, setOptimisticHomepage] = useState(null);
  const effectiveHomepage = optimisticHomepage !== null ? optimisticHomepage : showOnHomepage;

  useEffect(() => {
    if (justAdded) setNewHandle("");
  }, [justAdded]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      if (fetcher.formData?.get("intent") === "add") {
        shopify?.toast?.show?.("Product linked");
      } else if (fetcher.formData?.get("intent") === "remove") {
        shopify?.toast?.show?.("Product unlinked");
      }
      onActionSuccess?.();
    }
  }, [fetcher.state, fetcher.data?.ok, fetcher.formData, shopify, onActionSuccess]);

  useEffect(() => {
    if (homepageFetcher.state === "idle" && isSetHomepageForThisReel && homepageFetcher.data?.ok && onActionSuccess) {
      setOptimisticHomepage(null);
      onActionSuccess();
    }
  }, [homepageFetcher.state, isSetHomepageForThisReel, homepageFetcher.data?.ok, onActionSuccess]);

  useEffect(() => {
    if (homepageFetcher.state === "idle" && isSetHomepageForThisReel && homepageFetcher.data && !homepageFetcher.data.ok) {
      setOptimisticHomepage(null);
    }
  }, [homepageFetcher.state, isSetHomepageForThisReel, homepageFetcher.data]);

  const handleSelectProduct = async () => {
    if (!shopify?.resourcePicker || isBusy || pickerLoading) return;
    setPickerLoading(true);
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: true,
      });
      if (selected && Array.isArray(selected) && selected.length > 0) {
        const product = selected[0];
        const handle = product?.handle ? String(product.handle).trim().toLowerCase() : null;
        if (handle) {
          fetcher.submit(
            { intent: "add", reel_id: reel.id, product_handle: handle },
            { method: "post" }
          );
        }
      }
    } catch (err) {
      console.error("Resource picker error:", err);
    } finally {
      setPickerLoading(false);
    }
  };

  const handleAdd = (e) => {
    e.preventDefault();
    const handle = String(newHandle).trim();
    if (!handle) return;
    fetcher.submit(
      { intent: "add", reel_id: reel.id, product_handle: handle },
      { method: "post" }
    );
  };

  const isAddForThisReel = fetcher.formData?.get("intent") === "add" && fetcher.formData?.get("reel_id") === reel.id;
  const isRemoveForThisReel = fetcher.formData?.get("intent") === "remove" && fetcher.formData?.get("reel_id") === reel.id;
  const addError = isAddForThisReel && fetcher.data && !fetcher.data.ok && fetcher.data.error;
  const addSuccess = isAddForThisReel && fetcher.data?.ok;
  const removeError = isRemoveForThisReel && fetcher.data && !fetcher.data.ok && fetcher.data.error;
  const primaryHandle = productHandles[0] || "";

  return (
    <div className="reel-ui-card">
      <div className="reel-ui-card-top">
        <div className="reel-ui-meta">
          <span className="reel-ui-handle" aria-hidden="true">⋮⋮</span>
          <span className="reel-ui-platform-badge">IG</span>
          <span>Instagram Reel</span>
        </div>
        <fetcher.Form method="post" style={{ display: "inline-flex" }}>
          {primaryHandle ? (
            <>
              <input type="hidden" name="intent" value="remove" />
              <input type="hidden" name="reel_id" value={reel.id} />
              <input type="hidden" name="product_handle" value={primaryHandle} />
              <button type="submit" className="reel-ui-trash" disabled={isBusy} aria-label="Unlink product">
                <span aria-hidden="true">🗑</span>
              </button>
            </>
          ) : (
            <span className="reel-ui-trash reel-ui-trash--muted" aria-hidden="true">🗑</span>
          )}
        </fetcher.Form>
      </div>

      <div className="reel-ui-thumb-wrap">
        {reel.thumbnail_url ? (
          <img src={reel.thumbnail_url} alt="" className="reel-ui-thumb" />
        ) : (
          <span className="reel-ui-empty">No preview</span>
        )}
        <span className="reel-ui-play" aria-hidden="true">▶</span>
      </div>

      <div className="reel-ui-actions">
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            if (isHomepageBusy) return;
            const next = !effectiveHomepage;
            setOptimisticHomepage(next);
            homepageFetcher.submit(
              { intent: "set_homepage", reel_id: reel.id, show_on_homepage: next ? "true" : "false" },
              { method: "post" }
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (isHomepageBusy) return;
              const next = !effectiveHomepage;
              setOptimisticHomepage(next);
              homepageFetcher.submit(
                { intent: "set_homepage", reel_id: reel.id, show_on_homepage: next ? "true" : "false" },
                { method: "post" }
              );
            }
          }}
          className="reel-ui-home-toggle"
          aria-checked={effectiveHomepage}
          aria-label="Show on homepage"
          aria-busy={isHomepageBusy}
        >
          <input
            type="checkbox"
            id={`homepage-${reel.id}`}
            checked={effectiveHomepage}
            disabled={isHomepageBusy}
            readOnly
            style={{ width: 14, height: 14, pointerEvents: "none" }}
          />
          <span>Show on homepage</span>
        </div>

        <s-button
          variant={primaryHandle ? "secondary" : "primary"}
          size="slim"
          onClick={handleSelectProduct}
          disabled={isBusy || pickerLoading || !shopify?.resourcePicker}
          {...(pickerLoading ? { loading: true } : {})}
        >
          {primaryHandle ? "Relink Product" : "Link Product"}
        </s-button>
      </div>

      {(homepageError || addError || removeError || addSuccess || productHandles.length > 1) && (
        <div className="reel-ui-feedback">
          {homepageError && (
            <s-banner tone="critical">
              {typeof homepageError === "string" ? homepageError : "Could not update homepage state."}
            </s-banner>
          )}
          {removeError && (
            <s-banner tone="critical">
              {typeof removeError === "string" ? removeError : "Could not remove product."}
            </s-banner>
          )}
          {addError && (
            <s-banner tone="critical">
              {typeof addError === "string" ? addError : "Could not link product."}
            </s-banner>
          )}
          {addSuccess && (
            <s-banner tone="success">Product linked.</s-banner>
          )}
          {productHandles.length > 1 && (
            <details className="reel-ui-details">
              <summary>{productHandles.length} linked products</summary>
              <div className="reel-ui-tag-list">
                {productHandles.map((productHandle) => (
                  <div key={productHandle} className="reel-ui-tag">
                    <span>{productHandle}</span>
                    <fetcher.Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="reel_id" value={reel.id} />
                      <input type="hidden" name="product_handle" value={productHandle} />
                      <button type="submit" disabled={isBusy} className="reel-ui-tag-remove">
                        Remove
                      </button>
                    </fetcher.Form>
                  </div>
                ))}
              </div>
            </details>
          )}
          <form onSubmit={handleAdd} className="reel-ui-handle-form">
            <input
              type="text"
              value={newHandle}
              onChange={(e) => setNewHandle(e.target.value)}
              placeholder="Add by product handle"
              className="reel-ui-handle-input"
            />
            <button type="submit" disabled={isBusy} className="reel-ui-handle-btn">
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function ReelsPage() {
  const { reels, configured, error, showReelsOnHomepage: initialShowReels, reelsApiUrl } = useLoaderData() ?? {};
  const revalidator = useRevalidator();
  const revalidateTimerRef = useRef(null);
  const shopify = useAppBridge();
  const homepageToggleFetcher = useFetcher();
  const [optimisticShow, setOptimisticShow] = useState(initialShowReels ?? true);
  const showReelsOnHomepage = optimisticShow ?? initialShowReels ?? true;
  const toggleBusy = homepageToggleFetcher.state === "submitting" || homepageToggleFetcher.state === "loading";
  const syncFetcher = useFetcher();
  const syncBusy = syncFetcher.state !== "idle";

  const scheduleRevalidate = useCallback(() => {
    if (revalidateTimerRef.current) return;
    revalidateTimerRef.current = setTimeout(() => {
      revalidateTimerRef.current = null;
      revalidator.revalidate();
    }, 250);
  }, [revalidator]);

  // After import, show new reels instantly from sync response, then revalidate loader
  const reelsToShow =
    syncFetcher.state === "idle" &&
    syncFetcher.data?.ok &&
    Array.isArray(syncFetcher.data.reels)
      ? syncFetcher.data.reels
      : reels;

  useEffect(() => {
    if (homepageToggleFetcher.state === "idle" && homepageToggleFetcher.data?.ok) {
      setOptimisticShow(homepageToggleFetcher.data.show_reels_on_homepage);
      scheduleRevalidate();
      shopify?.toast?.show?.("Homepage setting updated");
    }
  }, [homepageToggleFetcher.state, homepageToggleFetcher.data, scheduleRevalidate, shopify]);

  useEffect(() => {
    if (syncFetcher.state === "idle" && syncFetcher.data?.ok && syncFetcher.data?.inserted !== undefined) {
      const n = syncFetcher.data.inserted ?? 0;
      shopify?.toast?.show?.(n > 0 ? `Imported ${n} new reel${n !== 1 ? "s" : ""}` : "Sync complete");
      revalidator.revalidate();
    }
  }, [syncFetcher.state, syncFetcher.data, shopify, revalidator]);

  useEffect(() => () => {
    if (revalidateTimerRef.current) clearTimeout(revalidateTimerRef.current);
  }, []);

  const handleHomepageToggle = () => {
    const next = !showReelsOnHomepage;
    setOptimisticShow(next);
    homepageToggleFetcher.submit(
      { intent: "toggle_reels_on_homepage", show_reels_on_homepage: next ? "true" : "false" },
      { method: "post" }
    );
  };

  if (!configured) {
    return (
      <s-page heading="Shoppable Reels" inlineSize="large">
        <s-banner tone="warning">
          Set <code>REELS_API_URL</code> and <code>REELS_ADMIN_SECRET</code> in your app environment (e.g. .env or
          Shopify CLI) and redeploy. REELS_API_URL should be your Vercel API base (e.g.
          https://instagram-reels-api-mu.vercel.app). Add the same REELS_ADMIN_SECRET in Vercel env for
          reel-products API.
        </s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading="Shoppable Reels" inlineSize="large">
      <s-section heading="Store homepage">
        {homepageToggleFetcher.data && !homepageToggleFetcher.data.ok && (
          <s-banner tone="critical" style={{ marginBottom: 12 }}>
            {homepageToggleFetcher.data.error || "Could not update setting."}
          </s-banner>
        )}
        <s-stack direction="inline" gap="base" style={{ alignItems: "center" }}>
          <s-checkbox
            checked={!!showReelsOnHomepage}
            onChange={() => { if (!toggleBusy) handleHomepageToggle(); }}
            disabled={toggleBusy}
            aria-label="Show reels on store homepage"
          />
          <s-text type="strong">Show reels on store homepage</s-text>
        </s-stack>
        <s-paragraph tone="subdued" style={{ marginTop: 8 }}>
          When on, the Shoppable Reels section appears on your store's homepage (Shopify home). When off, it is hidden there.
        </s-paragraph>
      </s-section>
      <s-section heading="Link products to reels">
        <div className="reels-ui-shell" aria-live="polite" aria-busy={syncBusy}>
          <div className="reels-connections">
            <div className="reels-connection-card">
              <div className="reels-connection-left">
                <span className="reels-platform-icon reels-platform-icon--instagram" aria-hidden="true">IG</span>
                <div className="reels-connection-meta">
                  <span className="reels-connection-title">Instagram</span>
                  <span className="reels-connection-subtitle">{reelsToShow?.length ? "@connected" : "Connected (no reels yet)"}</span>
                </div>
              </div>
              <syncFetcher.Form method="post">
                <input type="hidden" name="intent" value="sync_reels" />
                <button type="submit" className="reels-connection-btn" disabled={syncBusy}>
                  {syncBusy ? "Importing..." : "Import"}
                </button>
              </syncFetcher.Form>
            </div>
            <div className="reels-connection-card">
              <div className="reels-connection-left">
                <span className="reels-platform-icon reels-platform-icon--tiktok" aria-hidden="true">TT</span>
                <div className="reels-connection-meta">
                  <span className="reels-connection-title">TikTok</span>
                  <span className="reels-connection-subtitle">Not connected</span>
                </div>
              </div>
              <button className="reels-connection-btn reels-connection-btn--dark" disabled>
                Connect
              </button>
            </div>
          </div>
          {syncFetcher.data && !syncFetcher.data.ok && (
            <s-banner tone="critical">{syncFetcher.data.error || "Could not sync reels."}</s-banner>
          )}
          {syncFetcher.data?.ok && (
            <s-banner tone="success">Import complete. New reels imported: {syncFetcher.data.inserted ?? 0}</s-banner>
          )}
          <div className="reels-gallery">
            <s-heading>Video Gallery</s-heading>
            <s-paragraph tone="subdued" style={{ marginTop: 4 }}>
              Import videos from your Instagram or TikTok account to display on your store.
            </s-paragraph>
            {error && (
              <s-banner tone="critical">
                Could not load reels: {error}
              </s-banner>
            )}
            {reelsToShow && reelsToShow.length === 0 ? (
              <div className="reels-empty-state">
                <s-text type="strong" style={{ display: "block", marginBottom: 8 }}>No reels yet</s-text>
                <s-paragraph tone="subdued">
                  Import videos from Instagram using the <strong>Import</strong> button above, or run a sync from your Reels API (
                <a href={reelsApiUrl ? `${reelsApiUrl.replace(/\/$/, "")}/api/sync` : "#"} target="_blank" rel="noopener noreferrer" className="reels-link-underline">
                  {reelsApiUrl ? `${reelsApiUrl.replace(/\/$/, "")}/api/sync` : "/api/sync"}
                </a>
                ) or add reels in Instagram. Sync returns 200 even when 0 reels are found—check the response for{" "}
                <code>reels</code> and <code>inserted</code>. To confirm the app is reading from the same API, open{" "}
                <a href={reelsApiUrl ? `${reelsApiUrl.replace(/\/$/, "")}/api/reels` : "#"} target="_blank" rel="noopener noreferrer" className="reels-link-underline">
                  {reelsApiUrl ? `${reelsApiUrl.replace(/\/$/, "")}/api/reels` : "/api/reels"}
                </a>{" "}
                in the browser and check if <code>reels</code> is empty there too.
                </s-paragraph>
              </div>
            ) : (
              <div className="reels-grid">
              {reelsToShow?.map((reel) => (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  shopify={shopify}
                  onActionSuccess={scheduleRevalidate}
                />
              ))}
              </div>
            )}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
