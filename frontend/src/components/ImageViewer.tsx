import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ImageViewerContext,
  type ImageViewerPayload,
} from "@/context/imageViewer";
import { cn, formatZoomPercentage } from "@/lib/utils";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const ZOOM_EPSILON = 0.0001;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const IMAGE_MAX_WIDTH_RATIO = 0.88;
const IMAGE_MAX_HEIGHT_RATIO = 0.78;

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

interface DragState {
  originPanX: number;
  originPanY: number;
  startPoint: Point;
}

interface LoadedImageSize {
  src: string;
  size: Size;
}

const DEFAULT_VIEW_STATE: ViewState = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

function clampZoom(value: number) {
  if (value <= MIN_ZOOM + ZOOM_EPSILON) {
    return MIN_ZOOM;
  }
  if (value >= MAX_ZOOM - ZOOM_EPSILON) {
    return MAX_ZOOM;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(6))));
}

function isPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getPayloadSize(payload: ImageViewerPayload | null): Size | null {
  if (!payload) {
    return null;
  }
  if (!isPositiveNumber(payload.width) || !isPositiveNumber(payload.height)) {
    return null;
  }
  return { width: payload.width, height: payload.height };
}

function getDefaultViewportSize(): Size {
  return {
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  };
}

function getViewportPoint(
  viewportElement: HTMLDivElement | null,
  clientX: number,
  clientY: number,
): Point | null {
  if (!viewportElement) {
    return null;
  }
  const rect = viewportElement.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function toLocalImagePoint(
  anchor: Point,
  view: ViewState,
  baseSize: Size,
  viewportSize: Size,
): Point {
  return {
    x:
      (anchor.x - viewportSize.width / 2 - view.panX) / view.zoom +
      baseSize.width / 2,
    y:
      (anchor.y - viewportSize.height / 2 - view.panY) / view.zoom +
      baseSize.height / 2,
  };
}

function panForLocalImagePoint(
  localPoint: Point,
  anchor: Point,
  zoom: number,
  baseSize: Size,
  viewportSize: Size,
): Point {
  return {
    x:
      anchor.x -
      viewportSize.width / 2 -
      (localPoint.x - baseSize.width / 2) * zoom,
    y:
      anchor.y -
      viewportSize.height / 2 -
      (localPoint.y - baseSize.height / 2) * zoom,
  };
}

function getBaseImageSize(
  imageSize: Size | null,
  viewportSize: Size,
): Size | null {
  if (
    !imageSize ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0 ||
    imageSize.width <= 0 ||
    imageSize.height <= 0
  ) {
    return null;
  }

  const fitScale = Math.min(
    (viewportSize.width * IMAGE_MAX_WIDTH_RATIO) / imageSize.width,
    (viewportSize.height * IMAGE_MAX_HEIGHT_RATIO) / imageSize.height,
    1,
  );

  return {
    width: imageSize.width * fitScale,
    height: imageSize.height * fitScale,
  };
}

function isPanExemptTarget(target: HTMLElement) {
  return Boolean(target.closest('[data-pan-exempt="true"]'));
}

function isPointerInsideElement(
  element: HTMLElement | null,
  clientX: number,
  clientY: number,
) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function getZoomedView(
  current: ViewState,
  factor: number,
  anchor: Point | undefined,
  baseSize: Size | null,
  viewportSize: Size,
): ViewState {
  const nextZoom = clampZoom(current.zoom * factor);
  if (
    !anchor ||
    !baseSize ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0 ||
    Math.abs(nextZoom - current.zoom) <= ZOOM_EPSILON
  ) {
    return nextZoom === current.zoom ? current : { ...current, zoom: nextZoom };
  }

  const localPoint = toLocalImagePoint(anchor, current, baseSize, viewportSize);
  const nextPan = panForLocalImagePoint(
    localPoint,
    anchor,
    nextZoom,
    baseSize,
    viewportSize,
  );

  return {
    panX: nextPan.x,
    panY: nextPan.y,
    zoom: nextZoom,
  };
}

function useResolvedImageSize(payload: ImageViewerPayload | null) {
  const payloadSize = useMemo(() => getPayloadSize(payload), [payload]);
  const [loadedImage, setLoadedImage] = useState<LoadedImageSize | null>(null);

  useEffect(() => {
    if (!payload || payloadSize) {
      return;
    }

    let active = true;
    const image = new Image();

    const handleLoad = () => {
      if (!active) {
        return;
      }
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setLoadedImage({
          src: payload.src,
          size: {
            width: image.naturalWidth,
            height: image.naturalHeight,
          },
        });
      }
    };

    image.addEventListener("load", handleLoad);
    image.src = payload.src;
    if (image.complete) {
      handleLoad();
    }

    return () => {
      active = false;
      image.removeEventListener("load", handleLoad);
    };
  }, [payload, payloadSize]);

  if (payloadSize) {
    return payloadSize;
  }
  if (!payload) {
    return null;
  }
  return loadedImage?.src === payload.src ? loadedImage.size : null;
}

function useViewportSize(
  active: boolean,
  viewportRef: MutableRefObject<HTMLDivElement | null>,
) {
  const [viewportSize, setViewportSize] = useState<Size>(
    getDefaultViewportSize,
  );

  useLayoutEffect(() => {
    if (!active || !viewportRef.current) {
      return;
    }

    const element = viewportRef.current;
    const syncViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: element.clientWidth || rect.width || window.innerWidth,
        height: element.clientHeight || rect.height || window.innerHeight,
      });
    };

    syncViewportSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncViewportSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [active, viewportRef]);

  return viewportSize;
}

function useImageViewerModalState(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, onClose]);
}

function useImageViewerGestures({
  active,
  baseImageSize,
  imageRef,
  onClose,
  viewportRef,
  viewportSize,
}: {
  active: boolean;
  baseImageSize: Size | null;
  imageRef: MutableRefObject<HTMLImageElement | null>;
  onClose: () => void;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  viewportSize: Size;
}) {
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [dragging, setDragging] = useState(false);
  const dragMovedRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);

  const reset = useCallback(() => {
    setView(DEFAULT_VIEW_STATE);
    setDragging(false);
    dragMovedRef.current = false;
    dragStateRef.current = null;
  }, []);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const pointer = getViewportPoint(
        viewportRef.current,
        event.clientX,
        event.clientY,
      );
      if (!pointer) {
        return;
      }

      if (
        pointer.x !== dragState.startPoint.x ||
        pointer.y !== dragState.startPoint.y
      ) {
        dragMovedRef.current = true;
      }

      setView((current) => ({
        ...current,
        panX: dragState.originPanX + pointer.x - dragState.startPoint.x,
        panY: dragState.originPanY + pointer.y - dragState.startPoint.y,
      }));
    };

    const handleMouseUp = () => {
      setDragging(false);
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, viewportRef]);

  const zoomByFactor = useCallback(
    (factor: number, anchor?: Point) => {
      setView((current) =>
        getZoomedView(current, factor, anchor, baseImageSize, viewportSize),
      );
    },
    [baseImageSize, viewportSize],
  );

  const handleWheelZoom = useCallback(
    (event: WheelEvent) => {
      const anchor = getViewportPoint(
        viewportRef.current,
        event.clientX,
        event.clientY,
      );
      if (!anchor) {
        return;
      }

      event.preventDefault();
      zoomByFactor(Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY), anchor);
    },
    [viewportRef, zoomByFactor],
  );

  useEffect(() => {
    if (!active || !viewportRef.current) {
      return;
    }

    const element = viewportRef.current;
    const handleWheel = (event: WheelEvent) => {
      handleWheelZoom(event);
    };

    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, [active, handleWheelZoom, viewportRef]);

  const handleViewportMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement;
      if (isPanExemptTarget(target)) {
        return;
      }

      const startPoint = getViewportPoint(
        viewportRef.current,
        event.clientX,
        event.clientY,
      );
      if (!startPoint) {
        return;
      }

      event.preventDefault();
      dragMovedRef.current = false;
      dragStateRef.current = {
        originPanX: view.panX,
        originPanY: view.panY,
        startPoint,
      };
      setDragging(true);
    },
    [view.panX, view.panY, viewportRef],
  );

  const handleViewportClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }

      const target = event.target as HTMLElement;
      if (isPanExemptTarget(target)) {
        return;
      }
      if (
        isPointerInsideElement(imageRef.current, event.clientX, event.clientY)
      ) {
        return;
      }

      onClose();
    },
    [imageRef, onClose],
  );

  return {
    dragging,
    handleViewportClick,
    handleViewportMouseDown,
    reset,
    view,
  };
}

export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<ImageViewerPayload | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeImageRef = useRef<() => void>(() => {});
  const imageSize = useResolvedImageSize(payload);
  const viewportSize = useViewportSize(Boolean(payload), viewportRef);
  const baseImageSize = useMemo(
    () => getBaseImageSize(imageSize, viewportSize),
    [imageSize, viewportSize],
  );

  const requestClose = useCallback(() => {
    closeImageRef.current();
  }, []);
  const {
    dragging,
    handleViewportClick,
    handleViewportMouseDown,
    reset,
    view,
  } = useImageViewerGestures({
    active: Boolean(payload),
    baseImageSize,
    imageRef,
    onClose: requestClose,
    viewportRef,
    viewportSize,
  });

  const closeImage = useCallback(() => {
    reset();
    setPayload(null);
  }, [reset]);

  useLayoutEffect(() => {
    closeImageRef.current = closeImage;
  }, [closeImage]);

  const openImage = useCallback(
    (nextPayload: ImageViewerPayload) => {
      reset();
      setPayload(nextPayload);
    },
    [reset],
  );

  useImageViewerModalState(Boolean(payload), closeImage);

  const value = useMemo(() => ({ openImage }), [openImage]);

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      {payload && typeof document !== "undefined"
        ? createPortal(
            <ImageViewerOverlay
              baseImageSize={baseImageSize}
              closeImage={closeImage}
              dragging={dragging}
              handleViewportClick={handleViewportClick}
              handleViewportMouseDown={handleViewportMouseDown}
              imageRef={imageRef}
              payload={payload}
              view={view}
              viewportRef={viewportRef}
            />,
            document.body,
          )
        : null}
    </ImageViewerContext.Provider>
  );
}

function ImageViewerOverlay({
  baseImageSize,
  closeImage,
  dragging,
  handleViewportClick,
  handleViewportMouseDown,
  imageRef,
  payload,
  view,
  viewportRef,
}: {
  baseImageSize: Size | null;
  closeImage: () => void;
  dragging: boolean;
  handleViewportClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleViewportMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  imageRef: MutableRefObject<HTMLImageElement | null>;
  payload: ImageViewerPayload;
  view: ViewState;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const imageLabel = payload.alt || "Image";
  const zoomLabel = formatZoomPercentage(view.zoom);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[120] bg-background/92 backdrop-blur-md"
      role="dialog"
    >
      <div
        ref={viewportRef}
        className="absolute inset-0 flex items-center justify-center p-4 sm:p-6"
        data-testid="global-image-viewer-backdrop"
        onClick={handleViewportClick}
        onMouseDown={handleViewportMouseDown}
      >
        <div
          className="absolute right-4 top-4 z-20 flex items-center gap-2"
          data-pan-exempt="true"
        >
          <div
            className="rounded-full border border-border bg-surface-overlay/88 px-3 py-1 text-[11px] font-medium text-foreground/88"
            data-pan-exempt="true"
            data-testid="global-image-viewer-zoom"
          >
            {zoomLabel}
          </div>
          <ViewerControlButton
            ariaLabel="Close image preview"
            onClick={closeImage}
          >
            <X className="size-4" />
          </ViewerControlButton>
        </div>
        <div
          className="absolute bottom-4 left-1/2 z-20 w-full max-w-3xl -translate-x-1/2 px-2"
          data-pan-exempt="true"
        >
          <div className="rounded-xl border border-border bg-surface-overlay/88 px-4 py-3 text-center">
            <div className="text-sm font-medium text-foreground">
              {imageLabel}
            </div>
            {payload.meta ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {payload.meta}
              </div>
            ) : null}
          </div>
        </div>
        {baseImageSize ? (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            data-testid="global-image-viewer-viewport"
          >
            <div
              className={cn(
                "relative transform-gpu will-change-transform",
                dragging
                  ? "transition-none"
                  : "transition-transform duration-120 ease-out",
              )}
              data-testid="global-image-viewer-stage"
              style={{
                height: `${baseImageSize.height}px`,
                transform: `translate3d(${view.panX}px, ${view.panY}px, 0px) scale(${view.zoom})`,
                transformOrigin: "center center",
                width: `${baseImageSize.width}px`,
              }}
            >
              <img
                alt={imageLabel}
                className={cn(
                  "block h-full w-full select-none object-contain",
                  dragging ? "cursor-grabbing" : "cursor-grab",
                )}
                data-testid="global-image-viewer-image"
                draggable={false}
                ref={imageRef}
                src={payload.src}
              />
            </div>
          </div>
        ) : (
          <img
            alt={imageLabel}
            className="max-h-[78vh] max-w-[88vw] select-none object-contain"
            data-testid="global-image-viewer-image"
            draggable={false}
            ref={imageRef}
            src={payload.src}
          />
        )}
      </div>
    </div>
  );
}

function ViewerControlButton({
  ariaLabel,
  children,
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={ariaLabel}
      className="rounded-full border border-border bg-surface-overlay/88 text-foreground/82 hover:bg-accent/60 hover:text-foreground"
      data-pan-exempt="true"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
