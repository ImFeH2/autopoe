import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, browser, expect } from "@wdio/globals";

const artifactsDir = resolve("artifacts", "desktop");

describe("Flowent desktop", () => {
  it("opens the real Tauri window", async () => {
    await expect(browser).toHaveTitle("Flowent");
    await expect($("h1")).toHaveText("Flowent");

    const windows = await browser.tauri.listWindows();
    expect(windows).toContain("main");
  });

  it("accepts WebDriver input and clicks", async () => {
    await browser.execute(() => {
      const fixture = document.createElement("form");
      fixture.dataset.testid = "webdriver-probe";
      fixture.style.cssText =
        "position:fixed;top:16px;left:16px;z-index:9999;display:flex;gap:8px;padding:8px;background:white;color:black";

      const input = document.createElement("input");
      input.dataset.testid = "webdriver-input";
      input.setAttribute("aria-label", "WebDriver input");

      const button = document.createElement("button");
      button.type = "submit";
      button.dataset.testid = "webdriver-submit";
      button.textContent = "Apply";

      const output = document.createElement("output");
      output.dataset.testid = "webdriver-output";

      fixture.addEventListener("submit", (event) => {
        event.preventDefault();
        output.textContent = input.value;
      });
      fixture.append(input, button, output);
      document.body.append(fixture);
    });

    await $("[data-testid='webdriver-input']").setValue("Flowent");
    await $("[data-testid='webdriver-submit']").click();
    await expect($("[data-testid='webdriver-output']")).toHaveText("Flowent");

    await browser.execute(() => {
      document.querySelector("[data-testid='webdriver-probe']")?.remove();
    });
  });

  it("captures the rendered window", async () => {
    const screenshot = await browser.takeScreenshot();
    expect(screenshot.length).toBeGreaterThan(1_000);

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      resolve(artifactsDir, "flowent.png"),
      Buffer.from(screenshot, "base64"),
    );
  });
});
