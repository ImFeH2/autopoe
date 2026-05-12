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

  it("renders the toggle through the shared button primitive", () => {
    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={() => {}}
        onToggle={() => {}}
        toggleLabel="Condense navigation"
      />,
    );

    expect(screen.getByLabelText("Condense navigation")).toHaveAttribute(
      "data-slot",
      "button",
    );
  });

  it("keeps the toggle centered while pressed", () => {
    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={() => {}}
        onToggle={() => {}}
        toggleLabel="Condense navigation"
      />,
    );

    expect(screen.getByLabelText("Condense navigation")).toHaveClass(
      "active:-translate-y-1/2",
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

  it("toggles from the control when it is keyboard activated", () => {
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

    fireEvent.click(screen.getByLabelText("Condense navigation"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("can hide the visible toggle control while keeping the divider toggleable", () => {
    const onMouseDown = vi.fn();
    const onToggle = vi.fn();

    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={onMouseDown}
        onToggle={onToggle}
        toggleLabel="Show icon navigation"
        showToggleControl={false}
      />,
    );

    const resizer = screen.getByRole("button", {
      name: "Show icon navigation",
    });
    expect(resizer).not.toHaveAttribute("data-slot", "button");
    expect(screen.queryByLabelText("Show icon navigation")).toBe(resizer);

    fireEvent.mouseDown(resizer, { clientX: 240, clientY: 20 });
    fireEvent.click(resizer, { clientX: 241, clientY: 20 });

    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard activation when the visible toggle control is hidden", () => {
    const onToggle = vi.fn();

    render(
      <PanelResizer
        position="right"
        isDragging={false}
        onMouseDown={() => {}}
        onToggle={onToggle}
        toggleLabel="Show icon navigation"
        showToggleControl={false}
      />,
    );

    const resizer = screen.getByRole("button", {
      name: "Show icon navigation",
    });
    fireEvent.keyDown(resizer, { key: "Enter" });
    fireEvent.keyDown(resizer, { key: " " });

    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
