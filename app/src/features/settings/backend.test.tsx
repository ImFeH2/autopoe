import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Choices } from "../../components/ui/choices";
import { AppBackend } from "../../lib/app-backend";
import { createAppBackendMock } from "../../lib/mock";
import { BackendPage, targetFromValue, targetValue } from "./backend";

describe("App backend selection", () => {
  it("keeps backend identity distinct from its distribution name", () => {
    const target = { kind: "wsl" as const, distribution: "Test Distribution" };
    expect(targetFromValue(targetValue(target))).toEqual(target);
    expect(targetFromValue("native")).toEqual({ kind: "native" });
    expect(() => targetFromValue("wsl:")).toThrow();
    expect(() => targetFromValue("other")).toThrow();
  });

  it("saves the next backend without switching the active backend", async () => {
    const backend = createAppBackendMock(AppBackend);
    const changed = await backend.save({ kind: "wsl", distribution: "Debian" });
    expect(changed.active).toEqual({ kind: "native" });
    expect(changed.configured).toEqual({ kind: "wsl", distribution: "Debian" });
    expect(changed.restart_required).toBe(true);
    expect((await backend.status()).configured).toEqual(changed.configured);
    const restored = await backend.save({ kind: "native" });
    expect(restored.restart_required).toBe(false);
    await expect(
      backend.save({ kind: "wsl", distribution: "Missing" }),
    ).rejects.toThrow();
  });

  it("offers labelled radios with a single selected option", () => {
    const html = renderToStaticMarkup(
      <Choices
        label="Backend"
        value="native"
        options={[
          { value: "native", label: "Native" },
          { value: "wsl:Debian", label: "WSL · Debian" },
        ]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it("keeps App settings accessible when the business backend fails", () => {
    const html = renderToStaticMarkup(
      <BackendPage startupError="Backend unavailable" />,
    );
    expect(html).toContain("Backend unavailable");
    expect(html).toContain("Next start");
    expect(html).toContain("Save");
  });
});
