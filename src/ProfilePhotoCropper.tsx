import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n";

type NaturalSize = {
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ProfilePhotoCropperProps = {
  file: File;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (photo: string) => Promise<string | null>;
};

const OUTPUT_SIZE = 320;
const MAX_DATA_URL_LENGTH = 240_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function encodeJpeg(canvas: HTMLCanvasElement) {
  for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (
      dataUrl.startsWith("data:image/jpeg;base64,") &&
      dataUrl.length <= MAX_DATA_URL_LENGTH
    ) {
      return dataUrl;
    }
  }

  throw new Error(t("Profilfoto konnte nicht verarbeitet werden."));
}

export function ProfilePhotoCropper({
  file,
  saving,
  onCancel,
  onConfirm,
}: ProfilePhotoCropperProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [imageSrc, setImageSrc] = useState("");
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);
  const [viewportSize, setViewportSize] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setImageSrc(objectUrl);
    setNaturalSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLoadError("");
    setSaveError("");

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSize = () => setViewportSize(viewport.clientWidth);
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  const baseScale = useMemo(() => {
    if (!naturalSize || viewportSize <= 0) return 1;
    return Math.max(
      viewportSize / naturalSize.width,
      viewportSize / naturalSize.height,
    );
  }, [naturalSize, viewportSize]);

  const displayScale = baseScale * zoom;
  const scaledWidth = naturalSize ? naturalSize.width * displayScale : viewportSize;
  const scaledHeight = naturalSize ? naturalSize.height * displayScale : viewportSize;
  const maxOffsetX = Math.max(0, (scaledWidth - viewportSize) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - viewportSize) / 2);

  function constrainedOffset(next: Point) {
    return {
      x: clamp(next.x, -maxOffsetX, maxOffsetX),
      y: clamp(next.y, -maxOffsetY, maxOffsetY),
    };
  }

  useEffect(() => {
    setOffset((current) => constrainedOffset(current));
    // The bounds intentionally track zoom, image dimensions and viewport size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxOffsetX, maxOffsetY]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (saving || !naturalSize) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setOffset(
      constrainedOffset({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      }),
    );
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function confirmCrop() {
    const image = imageRef.current;
    if (!image || !naturalSize || viewportSize <= 0 || saving) return;

    setSaveError("");

    try {
      const cropSize = viewportSize / displayScale;
      const sourceX = clamp(
        (naturalSize.width - cropSize) / 2 - offset.x / displayScale,
        0,
        Math.max(0, naturalSize.width - cropSize),
      );
      const sourceY = clamp(
        (naturalSize.height - cropSize) / 2 - offset.y / displayScale,
        0,
        Math.max(0, naturalSize.height - cropSize),
      );

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(t("Profilfoto konnte nicht verarbeitet werden."));
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        cropSize,
        cropSize,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE,
      );

      const dataUrl = encodeJpeg(canvas);
      const error = await onConfirm(dataUrl);
      if (error) setSaveError(error);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : t("Profilfoto konnte nicht verarbeitet werden."),
      );
    }
  }

  return (
    <div
      className="profile-crop-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <section
        className="profile-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-crop-title"
      >
        <div className="profile-crop-header">
          <div>
            <h2 id="profile-crop-title">{t("Profilbild zuschneiden")}</h2>
            <p>{t("Verschiebe und vergrößere das Bild, bis der Ausschnitt passt.")}</p>
          </div>
          <button
            type="button"
            className="profile-crop-close"
            aria-label={t("Schließen")}
            disabled={saving}
            onClick={onCancel}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
            </svg>
          </button>
        </div>

        <div className="profile-crop-stage-shell">
          <div
            ref={viewportRef}
            className="profile-crop-stage"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {imageSrc && (
              <img
                ref={imageRef}
                src={imageSrc}
                alt=""
                draggable={false}
                className="profile-crop-image"
                style={{
                  width: scaledWidth || undefined,
                  height: scaledHeight || undefined,
                  transform:
                    `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (!image.naturalWidth || !image.naturalHeight) {
                    setLoadError(t("Profilfoto konnte nicht verarbeitet werden."));
                    return;
                  }

                  setNaturalSize({
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  });
                  setLoadError("");
                }}
                onError={() =>
                  setLoadError(t("Profilfoto konnte nicht verarbeitet werden."))
                }
              />
            )}
            <span className="profile-crop-ring" aria-hidden="true" />
          </div>
        </div>

        <div className="profile-crop-control">
          <div className="profile-crop-control-head">
            <span>{t("Zoom")}</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              {t("Zurücksetzen")}
            </button>
          </div>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            disabled={saving || Boolean(loadError) || !naturalSize}
            aria-label={t("Zoom")}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <small>{t("Bild mit dem Finger verschieben")}</small>
        </div>

        {(loadError || saveError) && (
          <div className="profile-crop-error" role="alert">
            {loadError || saveError}
          </div>
        )}

        <div className="profile-crop-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={onCancel}
          >
            {t("Abbrechen")}
          </button>
          <button
            type="button"
            className="gold-cta"
            disabled={saving || Boolean(loadError) || !naturalSize}
            onClick={() => void confirmCrop()}
          >
            {saving ? t("Foto wird gespeichert …") : t("Profilbild verwenden")}
          </button>
        </div>
      </section>
    </div>
  );
}
