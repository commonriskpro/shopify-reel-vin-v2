/**
 * admin.setup — One-click filter setup for the vehicle inventory collection.
 *
 * Creates Shopify metafield definitions (vin_decoder.*) with PUBLIC_READ storefront
 * access so Search & Discovery surfaces them as collection filter options.
 * After running this, go to:
 *   Shopify Admin → Apps → Search & Discovery → Filters → Add filter
 * and enable each vehicle filter.
 */
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createVehicleMetafieldDefinitions,
  VEHICLE_METAFIELD_DEFINITIONS, // used in loader only (server) — not referenced in component
} from "../services/metafield-definitions.server.js";
import { enforceRateLimit } from "../security.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { definitions: VEHICLE_METAFIELD_DEFINITIONS };
};

export const action = async ({ request }) => {
  if (request.method !== "POST") return null;
  let admin, session;
  try {
    ({ admin, session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  const limited = enforceRateLimit(request, {
    scope: "admin.setup.create-definitions",
    limit: 10,
    windowMs: 60_000,
    keyParts: [session?.shop || "unknown"],
  });
  if (!limited.ok) {
    return Response.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  const results = await createVehicleMetafieldDefinitions(admin);
  const allOk = results.every((r) => r.status !== "error");
  return Response.json({ ok: allOk, results });
};

// Status badge helper
function StatusBadge({ status }) {
  const map = {
    created: { label: "Created",      color: "#008060", bg: "#f4faf6", border: "#b3e0c6" },
    updated: { label: "Updated",      color: "#2c6ecb", bg: "#f0f5ff", border: "#b9d4f7" },
    ok:      { label: "Already set",  color: "#6d7175", bg: "#f6f6f7", border: "#e3e3e3" },
    exists:  { label: "Already set",  color: "#6d7175", bg: "#f6f6f7", border: "#e3e3e3" },
    error:   { label: "Error",        color: "#b04545", bg: "#fff8f8", border: "#fbb"    },
  };
  const s = map[status] || map.error;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: 10,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.border}`,
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
}

export default function SetupPage() {
  const { definitions } = useLoaderData() ?? {};
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const results = fetcher.data?.results ?? null;
  const allOk = results && results.every((r) => r.status !== "error");

  return (
    <s-page heading="Filter Setup">
      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      <s-section heading="Step 1 — Create metafield definitions">
        <s-paragraph>
          Your VIN decoder already saves vehicle data (Year, Make, Model, Mileage, etc.) as
          product metafields. To make them available as <strong>collection filters</strong>,
          Shopify needs a formal{" "}
          <em>metafield definition</em> for each field with public storefront access.
        </s-paragraph>
        <s-paragraph>
          Click the button below to create all{" "}
          <strong>{definitions?.length ?? 10} definitions</strong> at once. <strong>Title</strong> and{" "}
          <strong>Miles</strong> are pinned so they appear in the Shopify product admin and can be
          edited on any product. It is safe to run multiple times — already-existing definitions
          are updated if needed.
        </s-paragraph>

        <fetcher.Form method="post" style={{ margin: "16px 0" }}>
          <s-button
            type="submit"
            variant="primary"
            disabled={busy}
            {...(busy ? { loading: true } : {})}
          >
            {busy ? "Creating definitions…" : "Create metafield definitions"}
          </s-button>
        </fetcher.Form>

        {/* Results table */}
        {results && (
          <div style={{ marginTop: 12 }}>
            {allOk ? (
              <s-banner tone="success" style={{ marginBottom: 12 }}>
                All definitions are ready. Complete Step 2 below.
              </s-banner>
            ) : (
              <s-banner tone="warning" style={{ marginBottom: 12 }}>
                Some definitions could not be created — see details below.
              </s-banner>
            )}
            <div
              style={{
                border: "1px solid #e3e3e3",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {results.map((r, i) => (
                <div
                  key={r.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    background: i % 2 === 0 ? "#fff" : "#fafbfb",
                    borderBottom: i < results.length - 1 ? "1px solid #f1f1f1" : "none",
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 100, fontSize: 13 }}>{r.name}</span>
                  <code style={{ fontSize: 11, color: "#6d7175", flex: 1 }}>
                    vin_decoder.{r.key}
                  </code>
                  <StatusBadge status={r.status} />
                  {r.error && (
                    <span style={{ fontSize: 11, color: "#b04545", maxWidth: 200 }}>{r.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </s-section>

      {/* ── Step 2 ─────────────────────────────────────────────────────── */}
      <s-section heading="Step 2 — Enable filters in Search & Discovery">
        <s-paragraph>
          After Step 1, go to your Shopify admin and enable each filter:
        </s-paragraph>

        <div
          style={{
            background: "#f6f6f7",
            borderRadius: 8,
            padding: "16px 20px",
            margin: "12px 0",
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          <strong>1.</strong> Open{" "}
          <a
            href="https://admin.shopify.com/store/speedy-motor-group/apps/search-and-discovery"
            target="_top"
            style={{ color: "#2c6ecb" }}
          >
            Apps → Search & Discovery
          </a>
          <br />
          <strong>2.</strong> Click <strong>Filters</strong> in the left sidebar
          <br />
          <strong>3.</strong> Click <strong>Add filter</strong>
          <br />
          <strong>4.</strong> Select each vehicle field from the list:
          <ul style={{ margin: "6px 0 6px 20px", padding: 0 }}>
            {(definitions ?? []).map((d) => (
              <li key={d.key}>
                <strong>{d.name}</strong>{" "}
                <code style={{ fontSize: 11, color: "#6d7175" }}>vin_decoder.{d.key}</code>
              </li>
            ))}
          </ul>
          <strong>5.</strong> Click <strong>Save</strong>
        </div>

        <s-paragraph>
          Your <strong>/inventory/</strong> collection page will immediately show the filter
          sidebar. No theme changes are required — the collection template is already configured
          for vertical filtering.
        </s-paragraph>
      </s-section>

      {/* ── Step 3 ─────────────────────────────────────────────────────── */}
      <s-section heading="Step 3 — Verify">
        <s-paragraph>
          Open{" "}
          <a
            href="https://speedymotorgroup.com/collections/inventory"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#2c6ecb" }}
          >
            speedymotorgroup.com/collections/inventory
          </a>{" "}
          (or whichever URL your Inventory collection uses). You should see the filter
          sidebar with Year, Make, Model, Drivetrain, Fuel Type, Title Brand, Transmission,
          Mileage, and Price.
        </s-paragraph>
        <s-paragraph tone="subdued" style={{ fontSize: 12 }}>
          Note: Price is built into Shopify's filter system and does not require a metafield
          definition — enable it directly in Search & Discovery → Filters.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
