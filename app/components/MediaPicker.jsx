/**
 * MediaPicker — file browser, multi-upload, and drag-and-drop widget.
 *
 * All network calls go to /admin/media via React Router's useFetcher,
 * which carries the Shopify session cookie automatically. No App Bridge
 * token is required; the shop:null race condition cannot occur here.
 *
 * Features:
 *   - Drag-and-drop any number of files onto the dropzone
 *   - Multi-select via the file picker (multiple attribute)
 *   - Batch staged-upload: one API call for N files → parallel S3 uploads → one attach call
 *   - Per-file progress chips shown during upload
 *
 * Props:
 *   productId            – GID of an existing product; absent → "pending" mode
 *   pendingMedia         – controlled pending media array
 *   onPendingMediaChange – setter for pending media
 *   media                – controlled product media (from parent)
 *   onMediaChange        – notified after product media changes on server
 *   disabled             – disables all controls
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

// ---------------------------------------------------------------------------
// Constants & helpers — all common image and video formats
// ---------------------------------------------------------------------------

const ACCEPTED_MIME_RE = /^image\/|^video\//;
// Extensions when file.type is empty (e.g. some .jpg on Windows)
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|heic|ico|tiff?)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|ogv|m4v|quicktime)$/i;
const MODEL_EXT_RE = /\.(glb|gltf)$/i;
const ACCEPTED_EXT_RE = new RegExp(
  [IMAGE_EXT_RE.source, VIDEO_EXT_RE.source, MODEL_EXT_RE.source].join("|")
);

/** Extension → { mime, isVideo } for when file.type is missing */
const EXT_TO_MIME = {
  jpg: { mime: "image/jpeg", isVideo: false },
  jpeg: { mime: "image/jpeg", isVideo: false },
  png: { mime: "image/png", isVideo: false },
  gif: { mime: "image/gif", isVideo: false },
  webp: { mime: "image/webp", isVideo: false },
  svg: { mime: "image/svg+xml", isVideo: false },
  bmp: { mime: "image/bmp", isVideo: false },
  avif: { mime: "image/avif", isVideo: false },
  heic: { mime: "image/heic", isVideo: false },
  ico: { mime: "image/x-icon", isVideo: false },
  tiff: { mime: "image/tiff", isVideo: false },
  tif: { mime: "image/tiff", isVideo: false },
  mp4: { mime: "video/mp4", isVideo: true },
  webm: { mime: "video/webm", isVideo: true },
  mov: { mime: "video/quicktime", isVideo: true },
  avi: { mime: "video/x-msvideo", isVideo: true },
  ogv: { mime: "video/ogg", isVideo: true },
  m4v: { mime: "video/x-m4v", isVideo: true },
  glb: { mime: "model/gltf-binary", isVideo: false },
  gltf: { mime: "model/gltf+json", isVideo: false },
};

function getExtension(name) {
  if (!name || typeof name !== "string") return "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function getMimeAndKind(file) {
  if (file.type && ACCEPTED_MIME_RE.test(file.type)) {
    return {
      mime: file.type,
      isVideo: file.type.startsWith("video/"),
    };
  }
  const ext = getExtension(file.name);
  const entry = ext ? EXT_TO_MIME[ext] : null;
  if (entry) return { mime: entry.mime, isVideo: entry.isVideo };
  return { mime: "image/jpeg", isVideo: false };
}

function isAcceptedFile(file) {
  if (!file?.name) return false;
  if (file.type && ACCEPTED_MIME_RE.test(file.type)) return true;
  return ACCEPTED_EXT_RE.test(file.name);
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function getPreviewUrl(node) {
  if (node?.image?.url) return node.image.url;
  if (node?.preview?.image?.url) return node.preview.image.url;
  if (node?.sources?.[0]?.url) return node.sources[0].url;
  return null;
}

function getDisplayUrl(item, isPending) {
  if (isPending) {
    return item.previewUrl || (item.originalSource?.startsWith?.("http") ? item.originalSource : null);
  }
  return getPreviewUrl(item);
}

function errorMsg(data) {
  if (!data || data.ok) return null;
  const msg = data.error?.message ?? data.error?.code ?? "Request failed";
  const requestId = data.meta?.requestId;
  return requestId ? `${msg} (Request ID: ${requestId})` : msg;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MediaPicker({
  productId,
  pendingMedia = [],
  onPendingMediaChange,
  media,
  onMediaChange,
  disabled,
}) {
  // Five fetchers: product-media, files list, staged-uploads, add-product-media, reorder-product-media
  const productMediaFetcher = useFetcher();
  const filesFetcher = useFetcher();
  const stagedFetcher = useFetcher();
  const addMediaFetcher = useFetcher();
  const reorderFetcher = useFetcher();

  const fileInputRef = useRef(null);
  const dropzoneRef = useRef(null);
  const modalRef = useRef(null);

  // ---- UI state ----
  const [selectModalOpen, setSelectModalOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragMediaIndex, setDragMediaIndex] = useState(null);
  const [dropTargetIndex, setDropTargetIndex] = useState(null);
  const [filesState, setFilesState] = useState({
    loading: false,
    error: null,
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  const [mediaData, setMediaData] = useState(null);
  const [mediaLoadError, setMediaLoadError] = useState(null);
  const [mediaLoadRequestId, setMediaLoadRequestId] = useState(null);

  // ---- Upload state ----
  // Phase: "idle" | "awaiting-staged" | "uploading-s3" | "awaiting-add-media"
  const [uploadPhase, setUploadPhase] = useState("idle");
  const [uploadError, setUploadError] = useState(null);
  const [uploadRequestId, setUploadRequestId] = useState(null);
  // Per-file progress chips: [{ id, name, status: 'queued'|'uploading'|'done'|'error', error? }]
  const [uploadItems, setUploadItems] = useState([]);
  // Internal job state shared across async phases
  const uploadJobRef = useRef(null);
  // { items: [{ id, file, mime, isVideo, alt, target? }], successful?: [...] }

  // Track whether filesFetcher is in "load more" mode
  const filesAppendRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const hasProductId = Boolean(productId);
  const savedMedia =
    media && media.length
      ? media
      : mediaData?.ok === true
      ? mediaData.data?.media
      : null;
  const currentMedia = hasProductId ? savedMedia ?? [] : pendingMedia;
  const isPendingMode = !hasProductId;
  const savedMediaWithIds = hasProductId && Array.isArray(currentMedia) && currentMedia.length > 1 && currentMedia.every((m) => m?.id);
  const mediaLoadIsNotFound = mediaData?.error?.code === "NOT_FOUND";
  const uploading = uploadPhase !== "idle";

  // ---------------------------------------------------------------------------
  // Effects: product media load / refresh
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasProductId || !productId) return;
    productMediaFetcher.load(
      `/admin/media?intent=product-media&productId=${encodeURIComponent(productId)}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProductId, productId]);

  useEffect(() => {
    if (productMediaFetcher.state !== "idle") return;
    if (!productMediaFetcher.data) return;
    const data = productMediaFetcher.data;
    setMediaData(data);
    if (!data.ok) {
      setMediaLoadError(errorMsg(data));
      if (data.meta?.requestId) setMediaLoadRequestId(data.meta.requestId);
    } else {
      setMediaLoadError(null);
    }
  }, [productMediaFetcher.state, productMediaFetcher.data]);

  // ---------------------------------------------------------------------------
  // Effects: files list (modal)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (filesFetcher.state !== "idle") return;
    if (!filesFetcher.data) return;
    const data = filesFetcher.data;
    setFilesState((prev) => {
      if (!data.ok) {
        return { ...prev, loading: false, error: errorMsg(data) || "Failed to load files" };
      }
      const rawItems = data.data?.items ?? [];
      const newItems = rawItems.map((it) => ({
        ...it,
        mediaContentType: it.mediaContentType ?? it.type ?? "IMAGE",
      }));
      const pageInfo = data.data?.pageInfo ?? { hasNextPage: false, endCursor: null };
      return {
        loading: false,
        error: null,
        items: filesAppendRef.current ? [...prev.items, ...newItems] : newItems,
        pageInfo,
      };
    });
    filesAppendRef.current = false;
  }, [filesFetcher.state, filesFetcher.data]);

  // ---------------------------------------------------------------------------
  // Effects: upload chain
  // ---------------------------------------------------------------------------

  // Step 1 result: staged targets received → map to items, advance to S3 upload
  useEffect(() => {
    if (uploadPhase !== "awaiting-staged") return;
    if (stagedFetcher.state !== "idle") return;
    if (!stagedFetcher.data) return;

    const data = stagedFetcher.data;
    if (!data.ok) {
      setUploadError(errorMsg(data) || "Failed to get upload URLs");
      if (data.meta?.requestId) setUploadRequestId(data.meta.requestId);
      setUploadItems([]);
      setUploadPhase("idle");
      uploadJobRef.current = null;
      return;
    }

    const targets = data.data?.stagedTargets ?? [];
    const job = uploadJobRef.current;
    if (!targets.length || !job?.items?.length) {
      setUploadError("No upload targets returned");
      setUploadItems([]);
      setUploadPhase("idle");
      uploadJobRef.current = null;
      return;
    }

    // Attach each staged target to its corresponding file item
    uploadJobRef.current = {
      items: job.items.map((item, i) => ({ ...item, target: targets[i] ?? null })),
    };
    setUploadPhase("uploading-s3");
  }, [uploadPhase, stagedFetcher.state, stagedFetcher.data]);

  // Step 2: upload all files to S3 in parallel
  useEffect(() => {
    if (uploadPhase !== "uploading-s3") return;
    const job = uploadJobRef.current;
    if (!job?.items?.length) return;

    // Snapshot values needed in the async closure
    const snapIsPendingMode = isPendingMode;
    const snapPendingMedia = pendingMedia;
    const snapProductId = productId;
    const snapHasProductId = hasProductId;

    (async () => {
      // Mark all as uploading
      setUploadItems(job.items.map(({ id, name }) => ({ id, name, status: "uploading" })));

      // Parallel upload to S3/GCS
      const results = await Promise.all(
        job.items.map(async (item) => {
          if (!item.target?.url) {
            return { item, success: false, error: "No upload URL" };
          }
          try {
            const formData = new FormData();
            (item.target.parameters || []).forEach((p) => formData.append(p.name, p.value));
            formData.append("file", item.file);
            const res = await fetch(item.target.url, { method: "POST", body: formData });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return { item, success: true };
          } catch (e) {
            return { item, success: false, error: e?.message || "Upload failed" };
          }
        })
      );

      // Update per-file status chips
      setUploadItems(
        results.map(({ item, success, error }) => ({
          id: item.id,
          name: item.name,
          status: success ? "done" : "error",
          error,
        }))
      );

      const successful = results.filter((r) => r.success);

      if (snapIsPendingMode && onPendingMediaChange) {
        // Pending mode: add successful items to local pending list
        const newPending = successful.map(({ item }) => ({
          originalSource: item.target.resourceUrl,
          mediaContentType: item.isVideo ? "VIDEO" : "IMAGE",
          alt: item.alt,
          previewUrl: item.file.type.startsWith("image/")
            ? URL.createObjectURL(item.file)
            : undefined,
        }));
        onPendingMediaChange([...snapPendingMedia, ...newPending]);
        setUploadPhase("idle");
        uploadJobRef.current = null;
        setTimeout(() => setUploadItems([]), 2500);
        return;
      }

      if (!successful.length) {
        setUploadError(
          results.length === 1
            ? results[0].error || "Upload failed"
            : `All ${results.length} uploads failed`
        );
        setUploadPhase("idle");
        uploadJobRef.current = null;
        return;
      }

      if (snapHasProductId && snapProductId) {
        setUploadPhase("awaiting-add-media");
        uploadJobRef.current = { ...job, successful };
        addMediaFetcher.submit(
          {
            intent: "add-product-media",
            productId: snapProductId,
            media: successful.map(({ item }) => ({
              originalSource: item.target.resourceUrl,
              mediaContentType: item.isVideo ? "VIDEO" : "IMAGE",
              alt: item.alt,
            })),
          },
          { method: "POST", encType: "application/json", action: "/admin/media" }
        );
      } else {
        setUploadPhase("idle");
        uploadJobRef.current = null;
        setTimeout(() => setUploadItems([]), 2500);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPhase]);

  // Step 3 result: add-product-media done → refresh
  useEffect(() => {
    if (uploadPhase !== "awaiting-add-media") return;
    if (addMediaFetcher.state !== "idle") return;
    if (!addMediaFetcher.data) return;

    const data = addMediaFetcher.data;
    if (!data.ok) {
      setUploadError(errorMsg(data) || "Failed to add media to product");
      if (data.meta?.requestId) setUploadRequestId(data.meta.requestId);
    } else {
      onMediaChange?.(data.data?.media ?? []);
    }

    setUploadPhase("idle");
    uploadJobRef.current = null;
    setTimeout(() => setUploadItems([]), 2500);

    if (productId) {
      productMediaFetcher.load(
        `/admin/media?intent=product-media&productId=${encodeURIComponent(productId)}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPhase, addMediaFetcher.state, addMediaFetcher.data]);

  // Handle add-media from "pick existing file" (uploadPhase is idle during this)
  useEffect(() => {
    if (uploadPhase !== "idle") return;
    if (addMediaFetcher.state !== "idle") return;
    if (!addMediaFetcher.data) return;
    const data = addMediaFetcher.data;
    if (data.ok) {
      onMediaChange?.(data.data?.media ?? []);
      if (productId) {
        productMediaFetcher.load(
          `/admin/media?intent=product-media&productId=${encodeURIComponent(productId)}`
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMediaFetcher.state, addMediaFetcher.data]);

  // After reorder succeeds, refresh product media list
  useEffect(() => {
    if (reorderFetcher.state !== "idle" || !reorderFetcher.data?.ok || !productId) return;
    productMediaFetcher.load(
      `/admin/media?intent=product-media&productId=${encodeURIComponent(productId)}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderFetcher.state, reorderFetcher.data]);

  // Sync modal open state
  useEffect(() => {
    if (selectModalOpen && modalRef.current?.showOverlay) {
      modalRef.current.showOverlay();
    }
  }, [selectModalOpen]);

  // ---------------------------------------------------------------------------
  // Core upload entry point — processes any array of File objects
  // ---------------------------------------------------------------------------

  const processFiles = (fileArray) => {
    const valid = fileArray.filter(isAcceptedFile);
    if (!valid.length) {
      setUploadError("Unsupported file type. Use image (e.g. JPG, PNG, WebP) or video (e.g. MP4, WebM) formats.");
      return;
    }

    const items = valid.map((file) => {
      const { mime, isVideo } = getMimeAndKind(file);
      return {
        id: makeId(),
        file,
        mime,
        isVideo,
        alt: file.name,
        name: file.name,
      };
    });

    setUploadError(null);
    setUploadRequestId(null);
    setUploadItems(items.map(({ id, name }) => ({ id, name, status: "queued" })));
    uploadJobRef.current = { items };
    setUploadPhase("awaiting-staged");

    stagedFetcher.submit(
      {
        intent: "staged-uploads",
        files: items.map(({ file, mime }) => ({
          filename: file.name,
          mimeType: mime,
          fileSize: String(file.size),
        })),
      },
      { method: "POST", encType: "application/json", action: "/admin/media" }
    );
  };

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleUploadNew = () => {
    if (disabled || uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target?.files ?? []);
    e.target.value = "";
    if (files.length) processFiles(files);
  };

  // Drag-and-drop (don't show file-upload overlay when reordering thumbnails — keeps photos visible)
  const isMediaReorderDrag = (e) => e.dataTransfer?.types?.includes("application/x-shopify-media-index");
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMediaReorderDrag(e)) return;
    if (!disabled && !uploading) setIsDragOver(true);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMediaReorderDrag(e)) return;
    if (!disabled && !uploading) setIsDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when the pointer leaves the dropzone itself, not a child
    if (dropzoneRef.current && !dropzoneRef.current.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (disabled || uploading) return;
    if (e.dataTransfer.types.includes("application/x-shopify-media-index")) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) processFiles(files);
  };

  const handleSelectExisting = () => {
    if (disabled) return;
    setSelectModalOpen(true);
    setFilesState((prev) => ({ ...prev, loading: true, error: null, items: [] }));
    filesAppendRef.current = false;
    filesFetcher.load("/admin/media?intent=files&first=30");
  };

  const handleRemovePending = (index) => {
    const item = pendingMedia[index];
    if (item?.previewUrl?.startsWith?.("blob:")) URL.revokeObjectURL(item.previewUrl);
    onPendingMediaChange?.(pendingMedia.filter((_, i) => i !== index));
  };

  const canReorderPending = isPendingMode && onPendingMediaChange && pendingMedia.length > 1;
  const reorderBusy = reorderFetcher.state !== "idle";
  const canReorder =
    (canReorderPending || (savedMediaWithIds && productId)) && !reorderBusy;
  const MEDIA_REORDER_TYPE = "application/x-shopify-media-index";

  const handleMediaDragStart = (e, index) => {
    if (!canReorder) return;
    e.dataTransfer.setData(MEDIA_REORDER_TYPE, String(index));
    e.dataTransfer.effectAllowed = "move";
    setDragMediaIndex(index);
  };

  const handleMediaDragEnd = () => {
    setDragMediaIndex(null);
    setDropTargetIndex(null);
  };

  const handleMediaDragOver = (e, index) => {
    if (!canReorder || dragMediaIndex == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
  };

  const handleMediaDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleMediaDrop = (e, dropIndex) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragMediaIndex == null || dragMediaIndex === dropIndex) {
      setDragMediaIndex(null);
      setDropTargetIndex(null);
      return;
    }
    if (canReorderPending) {
      const next = [...pendingMedia];
      const [removed] = next.splice(dragMediaIndex, 1);
      next.splice(dropIndex, 0, removed);
      onPendingMediaChange?.(next);
      setDragMediaIndex(null);
      setDropTargetIndex(null);
      return;
    }
    if (savedMediaWithIds && productId) {
      const next = [...currentMedia];
      const [removed] = next.splice(dragMediaIndex, 1);
      next.splice(dropIndex, 0, removed);
      const mediaIds = next.map((m) => m.id).filter(Boolean);
      if (mediaIds.length === 0) {
        setDragMediaIndex(null);
        setDropTargetIndex(null);
        return;
      }
      reorderFetcher.submit(
        {
          intent: "reorder-product-media",
          productId,
          mediaIds,
        },
        { method: "POST", encType: "application/json", action: "/admin/media" }
      );
      setDragMediaIndex(null);
      setDropTargetIndex(null);
    }
  };

  const handlePickFile = (file) => {
    if (!file?.url) return;
    if (isPendingMode && onPendingMediaChange) {
      onPendingMediaChange([
        ...pendingMedia,
        {
          originalSource: file.url,
          mediaContentType: file.mediaContentType || "IMAGE",
          alt: file.alt,
          previewUrl: file.previewUrl || file.url,
        },
      ]);
      setSelectModalOpen(false);
      return;
    }
    if (!hasProductId || !productId) return;
    addMediaFetcher.submit(
      {
        intent: "add-product-media",
        productId,
        media: [
          {
            originalSource: file.url,
            mediaContentType: file.mediaContentType || "IMAGE",
            alt: file.alt,
          },
        ],
      },
      { method: "POST", encType: "application/json", action: "/admin/media" }
    );
    setSelectModalOpen(false);
  };

  const loadMoreFiles = () => {
    const { pageInfo } = filesState;
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return;
    setFilesState((prev) => ({ ...prev, loading: true }));
    filesAppendRef.current = true;
    filesFetcher.load(
      `/admin/media?intent=files&first=30&after=${encodeURIComponent(pageInfo.endCursor)}`
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const uploadStatusIcon = (status) => {
    if (status === "queued") return "⏳";
    if (status === "uploading") return "↑";
    if (status === "done") return "✓";
    if (status === "error") return "✗";
    return "";
  };

  return (
    <div className="media-picker">
      <div
        ref={dropzoneRef}
        className={`media-picker-dropzone${isDragOver ? " media-picker-dropzone--drag-over" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="media-picker-drag-overlay" aria-hidden="true">
            Drop files to upload
          </div>
        )}

        {/* Existing media thumbnails */}
        {reorderBusy && (
          <p className="media-picker-hint" style={{ marginBottom: 8 }}>Reordering…</p>
        )}
        {currentMedia.length > 0 && (
          <div className="media-picker-thumbnails">
            {currentMedia.map((m, index) => (
              <div
                key={m.id || index}
                className={`media-picker-thumb${dragMediaIndex === index ? " media-picker-thumb--dragging" : ""}${dropTargetIndex === index ? " media-picker-thumb--drop-target" : ""}`}
                draggable={canReorder}
                onDragStart={(e) => handleMediaDragStart(e, index)}
                onDragEnd={handleMediaDragEnd}
                onDragOver={(e) => handleMediaDragOver(e, index)}
                onDragLeave={handleMediaDragLeave}
                onDrop={(e) => handleMediaDrop(e, index)}
              >
                {canReorder && (
                  <span className="media-picker-thumb-grip" aria-hidden="true" title="Drag to reorder">
                    ⋮⋮
                  </span>
                )}
                <img
                  src={getDisplayUrl(m, isPendingMode) || ""}
                  alt={m.alt || ""}
                  loading="lazy"
                  onError={(e) => { e.target.style.display = "none"; }}
                  draggable={false}
                />
                {m.mediaContentType === "VIDEO" && (
                  <span className="media-picker-thumb-badge">Video</span>
                )}
                {isPendingMode && onPendingMediaChange && (
                  <button
                    type="button"
                    className="media-picker-thumb-remove"
                    onClick={() => handleRemovePending(index)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Per-file upload progress */}
        {uploadItems.length > 0 && (
          <div className="media-picker-upload-progress">
            {uploadItems.map((item) => (
              <div
                key={item.id}
                className={`media-picker-upload-item media-picker-upload-item--${item.status}`}
              >
                <span className="media-picker-upload-item-icon">
                  {uploadStatusIcon(item.status)}
                </span>
                <span className="media-picker-upload-item-name" title={item.name}>
                  {item.name}
                </span>
                {item.status === "error" && item.error && (
                  <span className="media-picker-upload-item-error">{item.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="media-picker-accepts">
          {uploading ? "Uploading…" : "Drag files here, or"}
        </p>
        <p className="media-picker-hint" style={{ marginTop: "4px", fontSize: "12px", color: "var(--p-color-subdued, #6d7175)" }}>
          All image formats (JPG, PNG, GIF, WebP, SVG, AVIF, HEIC, etc.) and video (MP4, WebM, MOV, etc.)
        </p>

        <div className="media-picker-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.avif,.heic,.mp4,.webm,.mov,.avi,.ogv,.m4v,.glb,.gltf"
            multiple
            className="media-picker-hidden-input"
            onChange={handleFileChange}
            disabled={disabled || uploading}
          />
          <button
            type="button"
            className="media-picker-btn"
            disabled={disabled || uploading}
            onClick={handleUploadNew}
          >
            Upload files
          </button>
          <button
            type="button"
            className="media-picker-btn"
            disabled={disabled || filesState.loading}
            onClick={handleSelectExisting}
          >
            {filesState.loading ? "Loading…" : "Select existing"}
          </button>
        </div>

        {isPendingMode && (
          <p className="media-picker-hint">Create the product first to attach media.</p>
        )}

        {(uploadError || mediaLoadError || (reorderFetcher.data && !reorderFetcher.data.ok && errorMsg(reorderFetcher.data))) && (
          <s-banner tone="critical" style={{ marginTop: "12px" }}>
            <span>
              {mediaLoadIsNotFound
                ? "Product or media not found."
                : reorderFetcher.data && !reorderFetcher.data.ok
                  ? errorMsg(reorderFetcher.data)
                  : uploadError || mediaLoadError}
            </span>
            {(uploadRequestId || mediaLoadRequestId) && (
              <span style={{ display: "block", marginTop: "6px", fontSize: "12px", opacity: 0.9 }}>
                Request ID:{" "}
                <code style={{ userSelect: "all", cursor: "text" }} title="Copy">
                  {uploadRequestId || mediaLoadRequestId}
                </code>
              </span>
            )}
          </s-banner>
        )}
      </div>

      {/* Select-from-files modal */}
      {selectModalOpen && (
        <s-modal
          ref={modalRef}
          id="media-picker-files-modal"
          heading="Select from Files"
          size="large"
        >
          <div className="media-picker-modal-content">
            {filesState.loading && !filesState.items.length ? (
              <p className="media-picker-loading">Loading files…</p>
            ) : filesState.error ? (
              <p className="media-picker-empty media-picker-error">{filesState.error}</p>
            ) : filesState.items.length === 0 ? (
              <p className="media-picker-empty">
                No files found. Upload images in Shopify Admin (Content → Files) or add
                media to a product first.
              </p>
            ) : (
              <div className="media-picker-files-grid">
                {filesState.items.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className="media-picker-file-card"
                    onClick={() => handlePickFile(file)}
                  >
                    <img src={file.previewUrl || file.url || ""} alt={file.alt || ""} />
                    <span className="media-picker-file-type">
                      {file.mediaContentType ?? file.type ?? "FILE"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {filesState.pageInfo.hasNextPage && filesState.items.length > 0 && (
              <s-button type="button" variant="secondary" onClick={loadMoreFiles}>
                Load more
              </s-button>
            )}
          </div>
          <s-button
            slot="secondary-actions"
            type="button"
            variant="secondary"
            commandFor="media-picker-files-modal"
            command="--hide"
            onClick={() => setSelectModalOpen(false)}
          >
            Cancel
          </s-button>
        </s-modal>
      )}
    </div>
  );
}
