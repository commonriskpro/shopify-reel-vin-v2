const OPTIMIZER_MODE = (process.env.VIDEO_OPTIMIZER_MODE || "none").trim().toLowerCase();
const CLOUDINARY_CLOUD_NAME = (process.env.VIDEO_CDN_CLOUD_NAME || "").trim();
const DEFAULT_VIDEO_WIDTH = Number(process.env.VIDEO_MAX_WIDTH || 960);
const DEFAULT_VIDEO_QUALITY = (process.env.VIDEO_QUALITY || "auto:good").trim();
const DEFAULT_IMAGE_QUALITY = (process.env.IMAGE_QUALITY || "auto:good").trim();

function isHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_VIDEO_WIDTH;
  return Math.max(240, Math.min(1920, Math.round(n)));
}

function cloudinaryFetchVideoUrl(sourceUrl, width) {
  if (!CLOUDINARY_CLOUD_NAME) return null;
  if (!isHttpUrl(sourceUrl)) return null;
  const w = normalizeWidth(width);
  const transforms = [`f_auto`, `q_${DEFAULT_VIDEO_QUALITY}`, `w_${w}`, "c_limit", "vc_auto"];
  return `https://res.cloudinary.com/${encodeURIComponent(
    CLOUDINARY_CLOUD_NAME
  )}/video/fetch/${transforms.join(",")}/${encodeURIComponent(sourceUrl)}`;
}

function cloudinaryFetchImageUrl(sourceUrl, width) {
  if (!CLOUDINARY_CLOUD_NAME) return null;
  if (!isHttpUrl(sourceUrl)) return null;
  const w = normalizeWidth(width);
  const transforms = [`f_auto`, `q_${DEFAULT_IMAGE_QUALITY}`, `w_${w}`, "c_limit"];
  return `https://res.cloudinary.com/${encodeURIComponent(
    CLOUDINARY_CLOUD_NAME
  )}/image/fetch/${transforms.join(",")}/${encodeURIComponent(sourceUrl)}`;
}

export function getVideoOptimizerConfig() {
  const enabled = OPTIMIZER_MODE === "cloudinary_fetch" && Boolean(CLOUDINARY_CLOUD_NAME);
  return {
    enabled,
    mode: enabled ? "cloudinary_fetch" : "none",
    defaultVideoWidth: normalizeWidth(DEFAULT_VIDEO_WIDTH),
  };
}

export function buildOptimizedPlaybackUrl(sourceUrl, { width } = {}) {
  if (OPTIMIZER_MODE !== "cloudinary_fetch") return null;
  return cloudinaryFetchVideoUrl(sourceUrl, width);
}

export function buildOptimizedPosterUrl(sourceUrl, { width } = {}) {
  if (OPTIMIZER_MODE !== "cloudinary_fetch") return null;
  return cloudinaryFetchImageUrl(sourceUrl, width);
}
