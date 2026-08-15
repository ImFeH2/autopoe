import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, browser, expect } from "@wdio/globals";

const artifactsDir = resolve("artifacts", "desktop");
const agentWorkDir = resolve(artifactsDir, "e2e-agent-work");
const agentWorkFile = resolve(agentWorkDir, "input.txt");

async function setLogicalWindowSize(width: number, height: number) {
  await browser.tauri.execute(
    ({ core }, nextWidth, nextHeight) =>
      core.invoke("plugin:window|set_size", {
        label: "main",
        value: { Logical: { width: nextWidth, height: nextHeight } },
      }),
    width,
    height,
  );
  await browser.waitUntil(async () => {
    const size = await browser.execute(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    }));
    return size.width === width && size.height === height;
  });
}

async function isFullyVisible(selector: string) {
  return browser.execute((targetSelector) => {
    const element = document.querySelector(String(targetSelector));
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  }, selector);
}

const destinations = ["Discussions", "Members", "Agents"];

async function expectCurrentDestination(label: string) {
  for (const destination of destinations) {
    expect(
      await $(`button[aria-label='${destination}']`).getAttribute(
        "aria-current",
      ),
    ).toBe(destination === label ? "page" : null);
  }
}

async function expectSelectedDiscussion(topic: string) {
  await expectCurrentDestination("Discussions");
  expect(
    await $(`button[aria-label='Open ${topic}']`).getAttribute("aria-current"),
  ).toBe("page");
  await expect($(`h2=${topic}`)).toExist();
}

async function createDiscussion(topic: string) {
  await $("button[aria-label='New discussion']").click();
  await expect($("[role='dialog']")).toExist();
  await expect($("h2=New discussion")).toExist();
  await expectCurrentDestination("Discussions");
  await $("#discussion-topic").setValue(topic);
  await $("#discussion-member-2").click();
  await $("form[aria-label='Create Discussion'] button[type='submit']").click();
  await expect($(`h2=${topic}`)).toExist();
  await expectSelectedDiscussion(topic);
  await browser.pause(550);
  await expectSelectedDiscussion(topic);
}

async function sendMessage(body: string, mentionIds: number[] = []) {
  for (const mentionId of mentionIds) {
    await $(`#message-mention-${mentionId}`).click();
  }
  await $("[aria-label='Message']").setValue(body);
  await $("form[aria-label='Send Message'] button").click();
  await expect($("[role='log']")).toHaveText(expect.stringContaining(body));
  await expect($("[aria-label='Message']")).toBeFocused();
}

describe("Flowent desktop", () => {
  before(async () => {
    await rm(agentWorkDir, { force: true, recursive: true });
    await mkdir(agentWorkDir, { recursive: true });
    await writeFile(agentWorkFile, "before\n");
    await browser.execute(() => {
      const errors: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...values: unknown[]) => {
        errors.push(values.map(String).join(" "));
        originalConsoleError(...values);
      };
      window.addEventListener("error", (event) => errors.push(event.message));
      window.addEventListener("unhandledrejection", (event) =>
        errors.push(String(event.reason)),
      );
      Object.assign(window, { __flowentTestErrors: errors });
    });
  });

  after(async () => {
    await rm(agentWorkDir, { force: true, recursive: true });
  });

  it("opens an empty in-memory Organization at the launch directory", async () => {
    await expect(browser).toHaveTitle("Flowent");
    await expect($("h1")).toHaveText("Flowent");
    await expect($("aside")).toHaveText(
      expect.stringContaining("/project/flowent"),
    );
    await expect($("[aria-label='Discussion list']")).toHaveText(
      expect.stringContaining("No discussions"),
    );
    await expect($("p=Select a discussion")).toExist();
    await expect($("form[aria-label='Create Discussion']")).not.toExist();
    await expect($("[aria-label='Search discussions']")).toExist();
    await expect($("button[aria-label='New discussion']")).toBeDisabled();
    await expect($("#recent-title")).not.toExist();
    for (const destination of destinations) {
      await expect($(`button[aria-label='${destination}']`)).toExist();
    }
    await expect($("button[aria-label='Overview']")).not.toExist();
    await expect($(".organization-switcher")).not.toExist();
    await expect($(".workspace-topbar")).not.toExist();
    await expect($(".workspace-breadcrumbs")).not.toExist();
    expect(
      await browser.execute(() => getComputedStyle(document.body).fontFamily),
    ).toContain('"Inter Variable"');
    expect(
      await browser.execute(() => {
        const sidebar = document.querySelector(".app-sidebar");
        const primaryButton = document.querySelector(".ui-button--primary");
        const navigationButton = document.querySelector(
          "button[aria-label='Discussions']",
        );
        if (!sidebar || !primaryButton || !navigationButton) {
          return null;
        }
        const buttonStyle = getComputedStyle(primaryButton);
        return {
          accent: buttonStyle.backgroundColor,
          canvas: getComputedStyle(document.body).backgroundColor,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          controlHeight: buttonStyle.height,
          controlRadius: buttonStyle.borderRadius,
          cursor: getComputedStyle(navigationButton).cursor,
          disabledCursor: buttonStyle.cursor,
          sidebar: getComputedStyle(sidebar).backgroundColor,
          transitionDuration: buttonStyle.transitionDuration,
        };
      }),
    ).toEqual({
      accent: "rgb(63, 93, 179)",
      canvas: "rgb(31, 30, 30)",
      colorScheme: "dark",
      controlHeight: "36px",
      controlRadius: "6px",
      cursor: "pointer",
      disabledCursor: "not-allowed",
      sidebar: "rgb(24, 23, 23)",
      transitionDuration: "0.12s, 0.12s, 0.12s, 0.12s, 0.1s",
    });
    expect(
      await browser.execute(() => {
        const main = document.querySelector("main");
        const search = document.querySelector(
          "[aria-label='Search discussions']",
        );
        if (!main || !search) {
          return null;
        }
        return {
          appContextMenu: main.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
          drag: main.dispatchEvent(
            new Event("dragstart", { bubbles: true, cancelable: true }),
          ),
          inputContextMenu: search.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
        };
      }),
    ).toEqual({
      appContextMenu: false,
      drag: false,
      inputContextMenu: true,
    });

    const windows = await browser.tauri.listWindows();
    expect(windows).toContain("main");

    await $("button[aria-label='Settings']").click();
    await expect($("h2=Settings")).toExist();
    await expect($("button=OpenAI")).toHaveAttribute("aria-pressed", "true");
    await expect($("[aria-label='Base URL']")).toHaveValue("");
    await expect($("[aria-label='API key']")).toHaveValue("");
    await expect($("[aria-label='Model']")).toHaveValue("");
    await expect($("#tracing-enabled")).not.toBeChecked();
    await expect($("[aria-label='Langfuse host']")).toHaveValue("");
    await expect($("[aria-label='Langfuse public key']")).toHaveValue("");
    await expect($("[aria-label='Langfuse secret key']")).toHaveValue("");
    await expect($("[aria-label='Tracing environment']")).toHaveValue(
      "development",
    );
    await expect($("#capture-content")).not.toBeChecked();
    await $("button=Anthropic").click();
    await $("[aria-label='Base URL']").setValue("https://example.invalid");
    await $("[aria-label='API key']").setValue("e2e-local-secret");
    await $("[aria-label='Model']").setValue("claude-test");
    await $("form[aria-label='Model settings'] button[type='submit']").click();
    await expect(
      $("form[aria-label='Model settings'] [role='status']"),
    ).toHaveText("Saved");
    await expect($("[aria-label='API key']")).toHaveValue("");
    await expect($("[aria-label='API key']")).toHaveAttribute(
      "placeholder",
      "Saved",
    );
    await $("#tracing-enabled").click();
    await $("[aria-label='Langfuse host']").setValue(
      "https://cloud.langfuse.com",
    );
    await $("[aria-label='Langfuse public key']").setValue("pk-lf-e2e");
    await $("[aria-label='Langfuse secret key']").setValue(
      "e2e-tracing-secret",
    );
    await $("[aria-label='Tracing environment']").setValue("e2e");
    await $("#capture-content").click();
    await $(
      "form[aria-label='Tracing settings'] button[type='submit']",
    ).click();
    await expect(
      $("form[aria-label='Tracing settings'] [role='status']"),
    ).toHaveText("Saved");
    await expect($("[aria-label='Langfuse secret key']")).toHaveValue("");
    await expect($("[aria-label='Langfuse secret key']")).toHaveAttribute(
      "placeholder",
      "Saved",
    );
    const settingsText = await browser.execute(() => document.body.textContent);
    expect(settingsText).not.toContain("e2e-local-secret");
    expect(settingsText).not.toContain("e2e-tracing-secret");
    await $("button[aria-label='Discussions']").click();
    await $("button[aria-label='Settings']").click();
    await expect($("button=Anthropic")).toHaveAttribute("aria-pressed", "true");
    await expect($("[aria-label='Base URL']")).toHaveValue(
      "https://example.invalid",
    );
    await expect($("[aria-label='Model']")).toHaveValue("claude-test");
    await expect($("#tracing-enabled")).toBeChecked();
    await expect($("[aria-label='Langfuse host']")).toHaveValue(
      "https://cloud.langfuse.com",
    );
    await expect($("[aria-label='Langfuse public key']")).toHaveValue(
      "pk-lf-e2e",
    );
    await expect($("[aria-label='Tracing environment']")).toHaveValue("e2e");
    await expect($("#capture-content")).toBeChecked();
    await expect($("[aria-label='Langfuse secret key']")).toHaveValue("");
    await expect($("[aria-label='Langfuse secret key']")).toHaveAttribute(
      "placeholder",
      "Saved",
    );
    await $("button[aria-label='Discussions']").click();
  });

  it("supports daily Human and Agent collaboration", async () => {
    await $("button[aria-label='Agents']").click();
    await expect($("h2=Agents")).toExist();
    await expectCurrentDestination("Agents");
    for (const name of ["Ada", "Lin"]) {
      await $("[aria-label='Agent name']").setValue(name);
      await $("form[aria-label='Create Agent'] button").click();
      await expect($(".entity-list")).toHaveText(expect.stringContaining(name));
    }
    await expect($(".entity-list")).toHaveText(expect.stringContaining("IDLE"));

    await $("button[aria-label='Members']").click();
    await expect($("h2=Members")).toExist();
    await expectCurrentDestination("Members");
    await expect($(".entity-list")).toHaveText(expect.stringContaining("You"));
    await expect($(".entity-list")).toHaveText(expect.stringContaining("Ada"));
    await expect($(".entity-list")).toHaveText(expect.stringContaining("Lin"));

    await $("button[aria-label='Discussions']").click();
    await expectCurrentDestination("Discussions");
    await expect($("p=Select a discussion")).toExist();
    await $("button[aria-label='New discussion']").click();
    await expect($("[role='dialog']")).toExist();
    await expect($("#discussion-topic")).toBeFocused();
    expect(
      await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            "[role='dialog'] button:not(:disabled), [role='dialog'] input:not(:disabled)",
          ),
        ).map(
          (element) =>
            element.getAttribute("aria-label") ||
            element.id ||
            element.textContent?.trim(),
        ),
      ),
    ).toEqual([
      "Close dialog",
      "discussion-topic",
      "discussion-member-2",
      "discussion-member-3",
      "Cancel",
    ]);
    await browser.keys(["Escape"]);
    await expect($("[role='dialog']")).not.toExist();
    await expect($("button[aria-label='New discussion']")).toBeFocused();
    await $("button[aria-label='New discussion']").click();
    await $("#discussion-topic").setValue("Repository work");
    await $("#discussion-member-2").click();
    await $("#discussion-member-3").click();
    await $(
      "form[aria-label='Create Discussion'] button[type='submit']",
    ).click();
    await expect($("h2=Repository work")).toExist();
    await expect($("p=You, Ada, Lin")).toExist();
    await expect($("[aria-label='Message']")).toBeFocused();

    await sendMessage(
      "E2E_REPOSITORY_TASK: inspect and update the controlled fixture.",
      [2],
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("@Ada · ACKED"),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Ada used exec and patch. status=0 verify=0"),
    );
    await expect($(".message-row--human .message-bubble")).toHaveText(
      expect.stringContaining("E2E_REPOSITORY_TASK"),
    );
    await expect($(".message-row--agent .message-bubble")).toHaveText(
      expect.stringContaining("Ada used exec and patch"),
    );
    expect(
      await browser.execute(() => {
        const body = document.querySelector(
          ".message-row--agent .message-body",
        );
        if (!body) {
          return null;
        }
        const selection = window.getSelection();
        selection?.selectAllChildren(body);
        const allowed = body.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
        selection?.removeAllRanges();
        return allowed;
      }),
    ).toBe(true);
    expect(await readFile(agentWorkFile, "utf8")).toBe("after\n");

    await $("#message-mention-2").click();
    await $("[aria-label='Message']").setValue(
      "E2E_RETRY_TASK: recover visibly.",
    );
    await browser.keys(["Enter"]);
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("E2E_RETRY_TASK: recover visibly."),
    );
    await $("button[aria-label='Agents']").click();
    await expect($(".entity-list")).toHaveText(
      expect.stringContaining("Model request failed"),
    );
    await expect($("button=Retry")).toExist();
    await $("button=Retry").click();
    await expect($("[aria-label='Agent name']")).toBeFocused();
    await expect($(".entity-list")).not.toHaveText(
      expect.stringContaining("Model request failed"),
    );
    await $("button[aria-label='Discussions']").click();
    await $("button[aria-label='Open Repository work']").click();
    await expectCurrentDestination("Discussions");
    expect(
      await $("button[aria-label='Open Repository work']").getAttribute(
        "aria-current",
      ),
    ).toBe("page");
    await expect($("h2=Repository work")).toExist();
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Ada completed the retried work."),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("@Ada · ACKED"),
    );
    await expect($("[aria-label='Message']")).toBeFocused();

    await sendMessage(
      "E2E_AGENT_HANDOFF: collaborate in this Discussion.",
      [2],
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("E2E_AGENT_FOLLOWUP: Ada asked Lin to continue."),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Lin completed the Agent handoff."),
    );
    expect(await isFullyVisible(".message-row:last-child")).toBe(true);
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("@Lin · ACKED"),
    );
    await $("button[aria-label='Agents']").click();
    await expect($(".entity-list")).toHaveText(expect.stringContaining("IDLE"));
    await $("button[aria-label='Discussions']").click();
    await $("button[aria-label='Open Repository work']").click();

    await $("#message-mention-3").click();
    await $("[aria-label='Message']").setValue("Human follow-up");
    const shiftEnterAccepted = await browser.execute(() => {
      const message = document.querySelector<HTMLTextAreaElement>(
        "[aria-label='Message']",
      );
      if (!message) {
        return false;
      }
      return message.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });
    expect(shiftEnterAccepted).toBe(true);
    await expect($("[aria-label='Message']")).toHaveValue("Human follow-up");
    await expect($("[role='log']")).not.toHaveText(
      expect.stringContaining("Human follow-up"),
    );
    await $("[aria-label='Message']").setValue(
      "Human follow-up\ncontinues here",
    );
    await browser.keys(["Enter"]);
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Human follow-up\ncontinues here"),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Lin received: Human follow-up\ncontinues here"),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("@Lin · ACKED"),
    );
    await expect($("[aria-label='Message']")).toBeFocused();

    await createDiscussion("Review history");
    await sendMessage("Second Discussion message one.");
    await $("[aria-label='Search discussions']").setValue("Review");
    await expect($("button[aria-label='Open Review history']")).toExist();
    await expect($("button[aria-label='Open Repository work']")).not.toExist();
    await $("[aria-label='Search discussions']").setValue("");
    await $("button[aria-label='Open Repository work']").click();
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Lin completed the Agent handoff."),
    );
    await expect($("[role='log']")).not.toHaveText(
      expect.stringContaining("Second Discussion message one."),
    );
  });

  it("keeps the collaboration workspace usable at target sizes", async () => {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
    ]) {
      await setLogicalWindowSize(width, height);
      expect(await isFullyVisible("aside")).toBe(true);
      for (const destination of destinations) {
        expect(
          await isFullyVisible(`button[aria-label='${destination}']`),
        ).toBe(true);
      }
      expect(await isFullyVisible(".discussion-list-pane")).toBe(true);
      expect(await isFullyVisible("[aria-label='Search discussions']")).toBe(
        true,
      );
      expect(await isFullyVisible("button[aria-label='New discussion']")).toBe(
        true,
      );
      expect(await isFullyVisible(".ui-list-button")).toBe(true);
      expect(await isFullyVisible(".sidebar-user")).toBe(true);
      expect(await isFullyVisible("form[aria-label='Send Message']")).toBe(
        true,
      );
      expect(await isFullyVisible("[aria-label='Message']")).toBe(true);
    }
  });

  it("finishes without renderer errors", async () => {
    const errors = await browser.execute(
      () =>
        (window as Window & { __flowentTestErrors?: string[] })
          .__flowentTestErrors ?? [],
    );
    expect(errors).toEqual([]);
  });

  it("captures the rendered product window", async () => {
    const screenshot = await browser.takeScreenshot();
    expect(screenshot.length).toBeGreaterThan(1_000);

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      resolve(artifactsDir, "flowent.png"),
      Buffer.from(screenshot, "base64"),
    );
  });
});
