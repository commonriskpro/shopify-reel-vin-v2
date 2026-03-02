import { useEffect, useRef, useState } from "react";
import { useApiClient, formatApiError } from "../lib/api.client.js";

function getPreviewUrl(node) {
  if (node?.image?.url) return node.image.url;
  if (node?.previewImage?.url) return node.previewImage.url;
  if (node?.sources?.[0]?.url) return node.sources[0].url;
  return null;
}

function getDisplayUrl(item, isPending) {
  if (isPending) {
    return item.previewUrl || (item.originalSource && item.originalSource.startsWith("http") ? item.originalSource : null);
  }
  return getPreviewUrl(item);
}

function formatMediaPickerError(result) {
  const msg = formatApiError(result);
  return msg || null;
}

export function MediaPicker({ productId, pendingMedia = [], onPendingMediaChange, media, onMediaChange, disabled }) {
  const { apiGet, apiPost } = useApiClient();

  const fileInputRef = useRef(null);
  const modalRef = useRef(null);
  const [selectModalOpen, setSelectModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadRequestId, setUploadRequestId] = useState(null);

  const [filesState, setFilesState] = useState({
    loading: false,
    error: null,
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });

  const [mediaData, setMediaData] = useState(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLoadError, setMediaLoadError] = useState(null);
  const [mediaLoadRequestId, setMediaLoadRequestId] = useState(null);

  const hasProductId = Boolean(productId);
  const savedMedia = (media && media.length) ? media : (mediaData?.ok === true ? mediaData?.data?.media : mediaData?.media) ?? [];
  const currentMedia = hasProductId ? savedMedia : pendingMedia;
  const isPendingMode = !hasProductId;
  const mediaLoadFailed = mediaData?.ok === false;
  const mediaLoadIsNotFound = mediaData?.error?.code === "NOT_FOUND";

  useEffect(() => {
    if (hasProductId && productId) {
      let cancelled = false;
      setMediaLoading(true);
      setMediaLoadError(null);
      apiGet(`/api/products/${encodeURIComponent(productId)}/media`).then((result) => {
        if (cancelled) return;
        setMediaLoading(false);
        setMediaData(result);
        if (result?.ok === false) setMediaLoadError(formatMediaPickerError(result));
        if (result?.meta?.requestId) setMediaLoadRequestId(result.meta.requestId);
      });
      return () => { cancelled = true; };
    }
  }, [hasProductId, productId]);

  useEffect(() => {
    if (selectModalOpen && modalRef.current?.showOverlay) {
      modalRef.current.showOverlay();
    }
  }, [selectModalOpen]);

  const handleUploadNew = () => {
    if (disabled) return;
    if (isPendingMode || hasProductId) fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadError(null);
    setUploadRequestId(null);
    setUploading(true);
    try {
      const mime = file.type || "image/jpeg";
      const stagedResult = await apiPost("/api/staged-uploads", {
        files: [{ filename: file.name, mimeType: mime, fileSize: String(file.size) }],
      });
      if (!stagedResult.ok) {
        setUploadRequestId(stagedResult.meta?.requestId);
        throw new Error(stagedResult.error?.message ?? "Failed to get upload URL");
      }
      const stagedTargets = stagedResult.data?.stagedTargets ?? [];
      const target = stagedTargets[0];
      if (!target?.url) {
        throw new Error("No upload target returned");
      }

      const formData = new FormData();
      (target.parameters || []).forEach((p) => formData.append(p.name, p.value));
      formData.append("file", file);
      const uploadRes = await fetch(target.url, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        throw new Error("Upload failed");
      }

      const isVideo = file.type.startsWith("video/");
      const mediaContentType = isVideo ? "VIDEO" : "IMAGE";
      const alt = file.name;

      if (isPendingMode && onPendingMediaChange) {
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        onPendingMediaChange([
          ...pendingMedia,
          { originalSource: target.resourceUrl, mediaContentType, alt, previewUrl },
        ]);
      } else if (hasProductId && productId) {
        const addResult = await apiPost(`/api/products/${encodeURIComponent(productId)}/media`, {
          media: [{ originalSource: target.resourceUrl, mediaContentType, alt }],
        });
        if (!addResult.ok) {
          setUploadRequestId(addResult.meta?.requestId);
          throw new Error(addResult.error?.message ?? "Failed to add media");
        }
        const addedMedia = addResult.data?.media ?? [];
        onMediaChange?.(addedMedia);
        const refresh = await apiGet(`/api/products/${encodeURIComponent(productId)}/media`);
        setMediaData(refresh);
      }
    } catch (err) {
      setUploadError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSelectExisting = () => {
    if (disabled) return;
    setSelectModalOpen(true);
    setFilesState((prev) => ({ ...prev, loading: true, error: null, items: [] }));
    apiGet("/api/files?first=30")
      .then((result) => {
        if (result.ok && result.data) {
          const rawItems = result.data?.items ?? result.data?.files ?? result.data?.nodes ?? [];
          const items = rawItems.map((it) => ({ ...it, mediaContentType: it.mediaContentType ?? it.type ?? "IMAGE" }));
          const pageInfo = result.data?.pageInfo ?? { hasNextPage: false, endCursor: null };
          setFilesState({ loading: false, error: null, items, pageInfo });
        } else {
          setFilesState((prev) => ({
            ...prev,
            loading: false,
            error: formatMediaPickerError(result) || "Failed to load files",
          }));
        }
      })
      .catch((e) => {
        setFilesState((prev) => ({ ...prev, loading: false, error: e?.message ?? "Failed to load files" }));
      });
  };

  const handleRemovePending = (index) => {
    const item = pendingMedia[index];
    if (item?.previewUrl && item.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
    onPendingMediaChange?.(pendingMedia.filter((_, i) => i !== index));
  };

  const handlePickFile = async (file) => {
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
    const addResult = await apiPost(`/api/products/${encodeURIComponent(productId)}/media`, {
      media: [
        { originalSource: file.url, mediaContentType: file.mediaContentType || "IMAGE", alt: file.alt },
      ],
    });
    if (addResult.ok && addResult.data?.media) {
      onMediaChange?.(addResult.data.media);
      const refresh = await apiGet(`/api/products/${encodeURIComponent(productId)}/media`);
      setMediaData(refresh);
    }
    setSelectModalOpen(false);
  };

  const loadMoreFiles = () => {
    const { pageInfo } = filesState;
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return;
    setFilesState((prev) => ({ ...prev, loading: true }));
    apiGet(`/api/files?first=30&after=${encodeURIComponent(pageInfo.endCursor)}`)
      .then((result) => {
        if (!result.ok || !result.data) {
          setFilesState((prev) => ({ ...prev, loading: false, error: formatMediaPickerError(result) || "Failed to load more" }));
          return;
        }
        const rawNew = result.data?.items ?? result.data?.files ?? result.data?.nodes ?? [];
        const newItems = rawNew.map((it) => ({ ...it, mediaContentType: it.mediaContentType ?? it.type ?? "IMAGE" }));
        const nextPageInfo = result.data?.pageInfo ?? { hasNextPage: false, endCursor: null };
        setFilesState((prev) => ({
          ...prev,
          loading: false,
          items: [...prev.items, ...newItems],
          pageInfo: nextPageInfo,
        }));
      })
      .catch((e) => {
        setFilesState((prev) => ({ ...prev, loading: false, error: e?.message ?? "Failed to load more" }));
      });
  };

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
          <p className="media-picker-hint">
            Create the product first to attach media.
          </p>
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
                    <img
                      src={file.previewUrl || file.url || ""}
                      alt={file.alt || ""}
                    />
                    <span className="media-picker-file-type">{file.mediaContentType ?? file.type ?? "FILE"}</span>
                  </button>
                ))}
              </div>
            )}
            {filesState.pageInfo.hasNextPage && filesState.items.length > 0 && (
              <s-button
                type="button"
                variant="secondary"
                onClick={loadMoreFiles}
              >
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
