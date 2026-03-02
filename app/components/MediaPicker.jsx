/**
 * MediaPicker — file browser + upload widget for the embedded admin.
 *
 * All network calls go to /admin/media via React Router's useFetcher,
 * which carries the Shopify session cookie automatically. No App Bridge
 * token is required; the shop:null race condition cannot occur here.
 *
 * Props (unchanged from previous version):
 *   productId          – GID of an existing product; if absent, media is "pending"
 *   pendingMedia       – array of pending media items (pre-product-create)
 *   onPendingMediaChange – setter for pending media
 *   media              – controlled product media (from parent)
 *   onMediaChange      – notified after product media changes
 *   disabled           – disables all controls
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPreviewUrl(node) {
  if (node?.image?.url) return node.image.url;
  if (node?.previewImage?.url) return node.previewImage.url;
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
  // Four independent fetchers — one per operation class so they never block
  // each other and state.data is unambiguous.
  const productMediaFetcher = useFetcher(); // GET product-media
  const filesFetcher = useFetcher();         // GET files list
  const stagedFetcher = useFetcher();        // POST staged-uploads
  const addMediaFetcher = useFetcher();      // POST add-product-media

  const fileInputRef = useRef(null);
  const modalRef = useRef(null);

  // ---- UI state ----
  const [selectModalOpen, setSelectModalOpen] = useState(false);
  const [filesState, setFilesState] = useState({
    loading: false,
    error: null,
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  const [mediaData, setMediaData] = useState(null);
  const [mediaLoadError, setMediaLoadError] = useState(null);
  const [mediaLoadRequestId, setMediaLoadRequestId] = useState(null);

  // ---- Upload chain state machine ----
  // Phases: "idle" | "awaiting-staged" | "uploading-s3" | "awaiting-add-media"
  const [uploadPhase, setUploadPhase] = useState("idle");
  const [uploadError, setUploadError] = useState(null);
  const [uploadRequestId, setUploadRequestId] = useState(null);
  const uploadJobRef = useRef(null);
  // { file, mime, isVideo, alt, target? }

  // Track whether filesFetcher is in "load more" (append) vs fresh load mode
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
  const mediaLoadFailed = mediaData?.ok === false;
  const mediaLoadIsNotFound = mediaData?.error?.code === "NOT_FOUND";
  const uploading = uploadPhase !== "idle";

  // ---------------------------------------------------------------------------
  // Effects: product media
  // ---------------------------------------------------------------------------

  // Initial load when productId is available
  useEffect(() => {
    if (!hasProductId || !productId) return;
    productMediaFetcher.load(
      `/admin/media?intent=product-media&productId=${encodeURIComponent(productId)}`
    );
    // productMediaFetcher.load is stable; productId/hasProductId are the real deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProductId, productId]);

  // Sync fetcher data → local state
  useEffect(() => {
    if (productMediaFetcher.state !== "idle") return;
    if (!productMediaFetcher.data) return;
    const data = productMediaFetcher.data;
    setMediaData(data);
    if (!data.ok) {
      setMediaLoadError(errorMsg(data));
      if (data.meta?.requestId) setMediaLoadRequestId(data.meta.requestId);
    }
  }, [productMediaFetcher.state, productMediaFetcher.data]);

  // ---------------------------------------------------------------------------
  // Effects: files list
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
  // Effects: upload chain — step 1 result (staged upload) → trigger S3 upload
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (uploadPhase !== "awaiting-staged") return;
    if (stagedFetcher.state !== "idle") return;
    if (!stagedFetcher.data) return;

    const data = stagedFetcher.data;
    if (!data.ok) {
      setUploadError(errorMsg(data) || "Failed to get upload URL");
      if (data.meta?.requestId) setUploadRequestId(data.meta.requestId);
      setUploadPhase("idle");
      uploadJobRef.current = null;
      return;
    }

    const target = data.data?.stagedTargets?.[0];
    if (!target?.url) {
      setUploadError("No upload target returned");
      setUploadPhase("idle");
      uploadJobRef.current = null;
      return;
    }

    // Store target and advance phase so the S3 upload effect fires
    uploadJobRef.current = { ...uploadJobRef.current, target };
    setUploadPhase("uploading-s3");
  }, [uploadPhase, stagedFetcher.state, stagedFetcher.data]);

  // Upload chain — step 2: push the file to the S3 staged target URL
  useEffect(() => {
    if (uploadPhase !== "uploading-s3") return;
    const job = uploadJobRef.current;
    if (!job?.target || !job?.file) return;

    (async () => {
      try {
        const formData = new FormData();
        (job.target.parameters || []).forEach((p) => formData.append(p.name, p.value));
        formData.append("file", job.file);
        // Direct upload to the external S3/GCS URL — no auth headers needed
        const res = await fetch(job.target.url, { method: "POST", body: formData });
        if (!res.ok) throw new Error("File upload to storage failed");

        if (isPendingMode && onPendingMediaChange) {
          // Pending mode: stage the media reference locally; no API call needed
          const previewUrl = job.file.type.startsWith("image/")
            ? URL.createObjectURL(job.file)
            : undefined;
          onPendingMediaChange([
            ...pendingMedia,
            {
              originalSource: job.target.resourceUrl,
              mediaContentType: job.isVideo ? "VIDEO" : "IMAGE",
              alt: job.alt,
              previewUrl,
            },
          ]);
          setUploadPhase("idle");
          uploadJobRef.current = null;
        } else if (hasProductId && productId) {
          // Product mode: attach the uploaded file to the product
          setUploadPhase("awaiting-add-media");
          addMediaFetcher.submit(
            {
              intent: "add-product-media",
              productId,
              media: [
                {
                  originalSource: job.target.resourceUrl,
                  mediaContentType: job.isVideo ? "VIDEO" : "IMAGE",
                  alt: job.alt,
                },
              ],
            },
            { method: "POST", encType: "application/json" }
          );
        } else {
          setUploadPhase("idle");
          uploadJobRef.current = null;
        }
      } catch (err) {
        setUploadError(err?.message || "Upload failed");
        setUploadPhase("idle");
        uploadJobRef.current = null;
      }
    })();
    // Only re-run when phase transitions to "uploading-s3"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPhase]);

  // Upload chain — step 3 result: add-product-media complete → refresh product media
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

    // Refresh the product media panel regardless of error (server might have partial success)
    if (productId) {
      productMediaFetcher.load(
        `/admin/media?intent=product-media&productId=${encodeURIComponent(productId)}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPhase, addMediaFetcher.state, addMediaFetcher.data]);

  // Also handle add-media results that come from handlePickFile (not the upload chain)
  useEffect(() => {
    if (uploadPhase !== "idle") return; // Upload chain handles its own phase
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
    // Errors from pick-file are silently dropped here; the UI doesn't show them
    // currently (unlike upload errors). Can be added if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMediaFetcher.state, addMediaFetcher.data]);

  // Keep the files modal open in sync with the modal ref
  useEffect(() => {
    if (selectModalOpen && modalRef.current?.showOverlay) {
      modalRef.current.showOverlay();
    }
  }, [selectModalOpen]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleUploadNew = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadError(null);
    setUploadRequestId(null);

    const mime = file.type || "image/jpeg";
    const isVideo = file.type.startsWith("video/");
    const alt = file.name;

    uploadJobRef.current = { file, mime, isVideo, alt };
    setUploadPhase("awaiting-staged");

    stagedFetcher.submit(
      { intent: "staged-uploads", files: [{ filename: file.name, mimeType: mime, fileSize: String(file.size) }] },
      { method: "POST", encType: "application/json" }
    );
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
    // Attach existing file to product — result handled by the "pick-file" effect above
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
      { method: "POST", encType: "application/json" }
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

  return (
    <div className="media-picker">
      <div className="media-picker-dropzone">
        {currentMedia.length > 0 && (
          <div className="media-picker-thumbnails">
            {currentMedia.map((m, index) => (
              <div key={m.id || index} className="media-picker-thumb">
                <img
                  src={getDisplayUrl(m, isPendingMode) || ""}
                  alt={m.alt || ""}
                  loading="lazy"
                  onError={(e) => { e.target.style.display = "none"; }}
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
        <p className="media-picker-accepts">Accepts images, videos, or 3D models</p>
        <div className="media-picker-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.glb,.gltf"
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
            {uploading ? "Uploading…" : "Upload new"}
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
        {(uploadError || mediaLoadError) && (
          <s-banner tone="critical" style={{ marginTop: "12px" }}>
            <span>{mediaLoadIsNotFound ? "Product or media not found." : (uploadError || mediaLoadError)}</span>
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
                No files found. Upload images in Shopify Admin (Content → Files) or add media to a product first.
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
                    <span className="media-picker-file-type">{file.mediaContentType ?? file.type ?? "FILE"}</span>
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
