import { render, screen } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fieldInputClassName,
  fieldTriggerClassName,
} from "@/components/flowent/styles";

const classList = (element: Element | string) =>
  (typeof element === "string" ? element : element.className)
    .toString()
    .split(/\s+/)
    .filter(Boolean);

describe("typography", () => {
  it("uses a 16px input size without a smaller desktop breakpoint", () => {
    render(<Input aria-label="Name" />);

    const classes = classList(screen.getByRole("textbox", { name: "Name" }));

    expect(classes).toContain("text-base");
    expect(classes).not.toContain("md:text-sm");
    expect(classes).not.toContain("text-xs");
  });

  it("uses readable 16px sizing for select triggers and options", () => {
    const { unmount } = render(
      <Select defaultValue="openai">
        <SelectTrigger aria-label="Provider">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">OpenAI</SelectItem>
        </SelectContent>
      </Select>,
    );

    const triggerClasses = classList(
      screen.getByRole("combobox", { name: "Provider" }),
    );

    expect(triggerClasses).toContain("text-base");
    expect(triggerClasses).not.toContain("text-sm");

    unmount();

    render(
      <Select defaultValue="openai" open>
        <SelectTrigger aria-label="Provider">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">OpenAI</SelectItem>
        </SelectContent>
      </Select>,
    );

    const optionClasses = classList(
      screen.getByRole("option", { name: "OpenAI" }),
    );

    expect(optionClasses).toContain("text-base");
    expect(optionClasses).not.toContain("text-sm");
  });

  it("uses 16px sizing for the default button style", () => {
    render(<Button>Save</Button>);

    const classes = classList(screen.getByRole("button", { name: "Save" }));

    expect(classes).toContain("text-base");
    expect(classes).not.toContain("text-sm");
    expect(classes).not.toContain("text-xs");
  });

  it("keeps browser zoom available in the viewport settings", async () => {
    const indexPath = join(process.cwd(), "index.html");
    const markup = await readFile(indexPath, "utf8");
    const viewport = markup.match(
      /<meta\s+name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    )?.[1];

    expect(viewport).toBe("width=device-width, initial-scale=1.0");
    expect(viewport).not.toContain("maximum-scale");
    expect(viewport).not.toContain("user-scalable=no");
  });

  it("limits drag selection to editable and readable content", async () => {
    const stylesPath = join(process.cwd(), "src/styles/index.css");
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain("user-select: none;");
    expect(styles).toContain("-webkit-user-select: none;");
    expect(styles).toContain("input,\ntextarea,");
    expect(styles).toContain(".flowent-markdown-message");
    expect(styles).toContain(".flowent-selectable-text");
    expect(styles).toContain("user-select: text;");
    expect(styles).toContain("-webkit-user-select: text;");
  });

  it("keeps readable dark colors before modern color declarations", async () => {
    const stylesPath = join(process.cwd(), "src/styles/index.css");
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toMatch(/--background:\s*#000;\s*--background:\s*oklch/);
    expect(styles).toMatch(/--foreground:\s*#fafafa;\s*--foreground:\s*oklch/);
    expect(styles).toMatch(/--popover:\s*#1d1d1d;\s*--popover:\s*oklch/);
    expect(styles).toMatch(/--input:\s*#343434;\s*--input:\s*oklch/);
  });

  it("keeps workflow node status visible without advanced border effects", async () => {
    const stylesPath = join(process.cwd(), "src/styles/index.css");
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain(
      "border: 1px solid var(--workflow-node-ring-border",
    );
    expect(styles).toContain("--workflow-node-ring-border: rgba(255, 255, 255");
    expect(styles).toContain("--workflow-node-ring-border: rgba(125, 223, 137");
    expect(styles).toContain("--workflow-node-ring-border: rgba(255, 116, 116");
    expect(styles).toContain(
      "@supports ((-webkit-mask-composite: xor) or (mask-composite: exclude))",
    );
    expect(styles).toContain(
      "@supports (color: color-mix(in srgb, white, black))",
    );
  });

  it("uses 16px sizing for shared Flowent form controls", () => {
    render(<Textarea aria-label="Prompt" className={fieldInputClassName} />);

    const textareaClasses = classList(
      screen.getByRole("textbox", { name: "Prompt" }),
    );

    expect(textareaClasses).toContain("text-base");
    expect(textareaClasses).not.toContain("md:text-sm");
    for (const classes of [
      classList(fieldInputClassName),
      classList(fieldTriggerClassName),
    ]) {
      expect(classes).toContain("text-base");
      expect(classes).not.toContain("text-[13px]");
      expect(classes).not.toContain("text-[12px]");
      expect(classes).not.toContain("text-sm");
      expect(classes).not.toContain("text-xs");
    }
  });
});
