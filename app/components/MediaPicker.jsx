import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { apiFetch } from "../lib/api-client.js";

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

function formatApiError(result) {
  if (!result || result.ok) return null;
  const msg = result.error?.message ?? result.error?.code ?? "Request failed";
  const requestId = result.meta?.requestId;
  return requestId ? `${msg} (Request ID: ${requestId})` : msg;
}

export function MediaPicker({ productId, pendingMedia = [], onPendingMediaChange, media, onMediaChange, disabled }) {
  const fileInputRef = useRef(null);
  const modalRef = useRef(null);
  const mediaFetcher = useFetcher({ key: "media" });
  const filesFetcher = useFetcher({ key: "files" });
  const [selectModalOpen, setSelectModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadRequestId, setUploadRequestId] = useState(null);

  const hasProductId = Boolean(productId);
  const mediaPayload = mediaFetcher.data?.ok === true ? mediaFetcher.data?.data : mediaFetcher.data;
  const savedMedia = (media && media.length) ? media : (mediaPayload?.media ?? mediaFetcher.data?.media ?? []);
  const currentMedia = hasProductId ? savedMedia : pendingMedia;
  const isPendingMode = !hasProductId;
  const mediaLoadFailed = mediaFetcher.data?.ok === false;
  const mediaLoadIsNotFound = mediaFetcher.data?.error?.code === "NOT_FOUND";
  const mediaLoadError = mediaLoadFailed ? formatApiError(mediaFetcher.data) : null;
  const mediaLoadRequestId = mediaFetcher.data?.meta?.requestId;

  useEffect(() => {
    if (hasProductId && productId && mediaFetcher.state === "idle" && !mediaFetcher.data) {
      mediaFetcher.load(`/api/products/${encodeURIComponent(productId)}/media`);
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
      const resource = mime.startsWith("video/") ? "PRODUCT_VIDEO" : "PRODUCT_IMAGE";
      const fileSize = resource === "PRODUCT_VIDEO" ? file.size : undefined;
      const stagedResult = await apiFetch("/api/staged-uploads", {
        method: "POST",
        body: JSON.stringify({
          files: [{ filename: file.name, mimeType: mime, fileSize }],
        }),
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

      const mediaContentType = resource === "PRODUCT_VIDEO" ? "VIDEO" : "IMAGE";
      const alt = file.name;

      if (isPendingMode && onPendingMediaChange) {
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        onPendingMediaChange([
          ...pendingMedia,
          { originalSource: target.resourceUrl, mediaContentType, alt, previewUrl },
        ]);
      } else if (hasProductId && productId) {
        const addResult = await apiFetch(`/api/products/${encodeURIComponent(productId)}/media`, {
          method: "POST",
          body: JSON.stringify({
            media: [{ originalSource: target.resourceUrl, mediaContentType, alt }],
          }),
        });
        if (!addResult.ok) {
          setUploadRequestId(addResult.meta?.requestId);
          throw new Error(addResult.error?.message ?? "Failed to add media");
        }
        const addedMedia = addResult.data?.media ?? [];
        onMediaChange?.(addedMedia);
        mediaFetcher.load(`/api/products/${encodeURIComponent(productId)}/media`);
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
    if (filesFetcher.state === "idle" && !filesFetcher.data) {
      filesFetcher.load("/api/files?first=30");
    }
  };

  const filesError = filesFetcher.data?.ok === false ? formatApiError(filesFetcher.data) : filesFetcher.data?.error;
  const filesRequestId = filesFetcher.data?.meta?.requestId;

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
    const addResult = await apiFetch(`/api/products/${encodeURIComponent(productId)}/media`, {
      method: "POST",
      body: JSON.stringify({
        media: [
          {
            originalSource: file.url,
            mediaContentType: file.mediaContentType || "IMAGE",
            alt: file.alt,
          },
        ],
      }),
    });
    if (addResult.ok && addResult.data?.media) {
      onMediaChange?.(addResult.data.media);
      mediaFetcher.load(`/api/products/${encodeURIComponent(productId)}/media`);
    }
    setSelectModalOpen(false);
  };

  const filesPayload = filesFetcher.data?.ok === true ? filesFetcher.data?.data : filesFetcher.data;
  const files = filesPayload?.nodes ?? filesFetcher.data?.nodes ?? [];
  const pageInfo = filesPayload?.pageInfo ?? filesFetcher.data?.pageInfo ?? { hasNextPage: false, endCursor: null };

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
            disabled={disabled || filesFetcher.state === "loading"}
            onClick={handleSelectExisting}
          >
            {filesFetcher.state === "loading" ? "Loading…" : "Select existing"}
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
            {filesFetcher.state === "loading" && !files.length ? (
              <p className="media-picker-loading">Loading files…</p>
            ) : filesError ? (
              <p className="media-picker-empty media-picker-error">
                {filesError}
                {filesRequestId && (
                  <span style={{ display: "block", marginTop: "6px", fontSize: "12px" }}>
                    Request ID: <code style={{ userSelect: "all" }}>{filesRequestId}</code>
                  </span>
                )}
              </p>
            ) : files.length === 0 ? (
              <p className="media-picker-empty">
                No files found. Upload images in Shopify Admin (Content → Files) or add media to a product first.
              </p>
            ) : (
              <div className="media-picker-files-grid">
                {files.map((file) => (
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
                    <span className="media-picker-file-type">{file.mediaContentType}</span>
                  </button>
                ))}
              </div>
            )}
            {pageInfo.hasNextPage && files.length > 0 && (
              <s-button
                type="button"
                variant="secondary"
                onClick={() =>
                  filesFetcher.load(
                    `/api/files?first=30&after=${encodeURIComponent(pageInfo.endCursor)}`
                  )
                }
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
