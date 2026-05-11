import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelResizer } from "@/components/PanelResizer";

describe("PanelResizer", () => {
  afterEach(() => {
    cleanup();
  });

  it("toggles the panel when the divider is clicked without dragging", () => {
    const onMouseDown = vi.fn();
    const onToggle = vi.fn();

    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={onMouseDown}
        onToggle={onToggle}
        toggleLabel="Condense navigation"
      />,
    );

    const resizer = screen.getByLabelText("Condense navigation").parentElement;
    expect(resizer).not.toBeNull();

    fireEvent.mouseDown(resizer as HTMLElement, { clientX: 240, clientY: 20 });
    fireEvent.click(resizer as HTMLElement, { clientX: 240, clientY: 21 });

    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not toggle after the divider was dragged", () => {
    const onToggle = vi.fn();

    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={() => {}}
        onToggle={onToggle}
        toggleLabel="Condense navigation"
      />,
    );

    const resizer = screen.getByLabelText("Condense navigation").parentElement;
    expect(resizer).not.toBeNull();

    fireEvent.mouseDown(resizer as HTMLElement, { clientX: 240, clientY: 20 });
    fireEvent.click(resizer as HTMLElement, { clientX: 252, clientY: 20 });

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("exposes the toggle control state", () => {
    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={() => {}}
        onToggle={() => {}}
        toggleLabel="Expand navigation"
        togglePressed
      />,
    );

    expect(screen.getByLabelText("Expand navigation")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("starts resizing from the toggle control", () => {
    const onMouseDown = vi.fn();
    const onToggle = vi.fn();

    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={onMouseDown}
        onToggle={onToggle}
        toggleLabel="Condense navigation"
      />,
    );

    const toggle = screen.getByLabelText("Condense navigation");
    fireEvent.mouseDown(toggle, {
      clientX: 240,
      clientY: 20,
    });
    fireEvent.click(toggle, { clientX: 252, clientY: 20 });

    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("toggles from the control when it is clicked without dragging", () => {
    const onToggle = vi.fn();

    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={() => {}}
        onToggle={onToggle}
        toggleLabel="Condense navigation"
      />,
    );

    const toggle = screen.getByLabelText("Condense navigation");
    fireEvent.mouseDown(toggle, { clientX: 240, clientY: 20 });
    fireEvent.click(toggle, { clientX: 241, clientY: 20 });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
