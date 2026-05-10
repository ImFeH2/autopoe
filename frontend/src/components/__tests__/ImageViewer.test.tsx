import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImageViewerProvider } from "@/components/ImageViewer";
import { useImageViewer } from "@/context/imageViewer";

afterEach(() => {
  cleanup();
});

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function Harness() {
  const { openImage } = useImageViewer();

  return (
    <button
      onClick={() =>
        openImage({
          src: "https://example.com/preview.png",
          alt: "Viewer image",
          meta: "image/png · 640x480",
          width: 640,
          height: 480,
        })
      }
      type="button"
    >
      Open preview
    </button>
  );
}

function readScale(element: HTMLElement) {
  const match = element.style.transform.match(/scale\(([-\d.]+)\)/);
  return Number(match?.[1] ?? "1");
}

function readTranslate(element: HTMLElement) {
  const match = element.style.transform.match(
    /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0px\)/,
  );
  return {
    x: Number(match?.[1] ?? "0"),
    y: Number(match?.[2] ?? "0"),
  };
}

function getLocalImagePoint(options: {
  anchor: { x: number; y: number };
  stage: HTMLElement;
  viewportRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}) {
  const scale = readScale(options.stage);
  const offset = readTranslate(options.stage);
  const centerX = options.viewportRect.left + options.viewportRect.width / 2;
  const centerY = options.viewportRect.top + options.viewportRect.height / 2;

  return {
    x: (options.anchor.x - centerX - offset.x) / scale,
    y: (options.anchor.y - centerY - offset.y) / scale,
  };
}

describe("ImageViewer", () => {
  it("uses gesture-first zooming and closes on Escape", () => {
    render(
      <ImageViewerProvider>
        <Harness />
      </ImageViewerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));

    expect(
      screen.getAllByRole("button", { name: "Close image preview" }),
    ).toHaveLength(1);
    expect(screen.getByTestId("global-image-viewer-zoom")).toHaveTextContent(
      "100%",
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(
      screen.queryAllByRole("button", { name: "Close image preview" }),
    ).toHaveLength(0);
  });

  it("zooms from both backdrop and image targets while preserving the pixel under the cursor", () => {
    setViewportSize(400, 300);
    render(
      <ImageViewerProvider>
        <Harness />
      </ImageViewerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));

    const backdrop = screen.getByTestId("global-image-viewer-backdrop");
    const image = screen.getByTestId("global-image-viewer-image");
    const viewport = screen.getByTestId("global-image-viewer-viewport");
    const stage = screen.getByTestId("global-image-viewer-stage");
    const viewportRect = {
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    Object.defineProperty(backdrop, "getBoundingClientRect", {
      configurable: true,
      value: () => viewportRect,
    });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => viewportRect,
    });
    Object.defineProperty(image, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 24,
        top: 18,
        width: 352,
        height: 264,
        right: 376,
        bottom: 282,
        x: 24,
        y: 18,
        toJSON: () => ({}),
      }),
    });
    const imageAnchor = { x: 280, y: 190 };
    const backgroundAnchor = { x: 36, y: 32 };

    expect(image).toHaveClass("cursor-grab");
    expect(screen.getByTestId("global-image-viewer-zoom")).toHaveTextContent(
      "100%",
    );

    fireEvent.wheel(backdrop, {
      deltaY: -100,
      clientX: backgroundAnchor.x,
      clientY: backgroundAnchor.y,
    });

    expect(readScale(stage)).toBeGreaterThan(1);
    expect(screen.getByTestId("global-image-viewer-zoom")).toHaveTextContent(
      `${Math.round(readScale(stage) * 100)}%`,
    );

    fireEvent.mouseDown(backdrop, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 160, clientY: 160 });
    fireEvent.mouseUp(window);
    expect(screen.getByTestId("global-image-viewer-zoom")).toHaveTextContent(
      `${Math.round(readScale(stage) * 100)}%`,
    );

    const beforeZoom = getLocalImagePoint({
      anchor: imageAnchor,
      stage,
      viewportRect,
    });

    fireEvent.wheel(image, {
      deltaY: -100,
      clientX: imageAnchor.x,
      clientY: imageAnchor.y,
    });

    const afterZoomIn = getLocalImagePoint({
      anchor: imageAnchor,
      stage,
      viewportRect,
    });
    expect(afterZoomIn.x).toBeCloseTo(beforeZoom.x, 4);
    expect(afterZoomIn.y).toBeCloseTo(beforeZoom.y, 4);

    fireEvent.wheel(backdrop, {
      deltaY: 100,
      clientX: imageAnchor.x,
      clientY: imageAnchor.y,
    });

    const afterZoomOut = getLocalImagePoint({
      anchor: imageAnchor,
      stage,
      viewportRect,
    });
    expect(afterZoomOut.x).toBeCloseTo(beforeZoom.x, 4);
    expect(afterZoomOut.y).toBeCloseTo(beforeZoom.y, 4);

    act(() => {
      fireEvent.wheel(image, {
        deltaY: -60,
        clientX: imageAnchor.x,
        clientY: imageAnchor.y,
      });
      fireEvent.wheel(image, {
        deltaY: -60,
        clientX: imageAnchor.x,
        clientY: imageAnchor.y,
      });
    });

    const afterRapidZoom = getLocalImagePoint({
      anchor: imageAnchor,
      stage,
      viewportRect,
    });
    expect(afterRapidZoom.x).toBeCloseTo(beforeZoom.x, 3);
    expect(afterRapidZoom.y).toBeCloseTo(beforeZoom.y, 3);
  });

  it("closes on visible background click without treating image content or drags as backdrop", () => {
    setViewportSize(400, 300);
    render(
      <ImageViewerProvider>
        <Harness />
      </ImageViewerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open preview" }));
    const backdrop = screen.getByTestId("global-image-viewer-backdrop");
    const image = screen.getByTestId("global-image-viewer-image");
    const stage = screen.getByTestId("global-image-viewer-stage");
    Object.defineProperty(backdrop, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 300,
        right: 400,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(image, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 24,
        top: 18,
        width: 352,
        height: 264,
        right: 376,
        bottom: 282,
        x: 24,
        y: 18,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(image, { clientX: 120, clientY: 120 });
    fireEvent.wheel(backdrop, {
      deltaY: -100,
      clientX: 260,
      clientY: 170,
    });
    fireEvent.mouseDown(stage, { button: 0, clientX: 120, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 145 });
    fireEvent.mouseUp(window);
    const visibleBackdrop = screen.getByRole("dialog")
      .lastElementChild as HTMLElement;

    fireEvent.click(stage);

    expect(
      screen.getAllByRole("button", { name: "Close image preview" }),
    ).toHaveLength(1);

    fireEvent.click(visibleBackdrop, { clientX: 8, clientY: 8 });

    expect(
      screen.queryAllByRole("button", { name: "Close image preview" }),
    ).toHaveLength(0);
  });
});
