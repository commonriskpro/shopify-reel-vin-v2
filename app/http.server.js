function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Keys (and lowercase variants) redacted from logs — no PII/secrets in logs. */
const SENSITIVE_KEYS = [
  "session", "sessionId", "token", "accessToken", "apiSecret", "password",
  "authorization", "cookie", "cookies", "bearer", "secret", "apiKey",
  "x-shopify-hmac-sha256", "x-shopify-webhook-signature", "x-shopify-access-token",
];
function sanitizeExtra(extra) {
  if (!extra || typeof extra !== "object") return extra;
  const out = { ...extra };
  const lowerKeys = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));
  for (const key of Object.keys(out)) {
    if (lowerKeys.has(key.toLowerCase())) out[key] = "[REDACTED]";
  }
  return out;
}

export function logServerError(context, err, extra = {}) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${context}] ${message}`, sanitizeExtra(extra));
}

export async function fetchJsonWithPolicy(
  url,
  { method = "GET", headers = {}, body, timeoutMs = 9000, retries = 1 } = {}
) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);

      const data = await parseJsonSafe(response);
      if (response.ok) {
        return { ok: true, status: response.status, data };
      }
      if (attempt < retries && shouldRetry(response.status)) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      return { ok: false, status: response.status, data, error: `HTTP ${response.status}` };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
        continue;
      }
    }
  }

  return { ok: false, status: 502, data: null, error: lastError?.message || "Network request failed" };
}
