import { $, $$, browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";
import { createAgent, waitForWorkspace } from "../support/app.mjs";

async function createCrowdAgent(name) {
  await $("aria/Members").click();
  await $("aria/New Agent").click();
  const form = await $("aria/Create Agent");
  await form.waitForDisplayed();
  await form.$("#agent-name").setValue(name);
  await form.$("button=Create").click();
  await $(`aria/${name} details`).waitForDisplayed();
}

describe("Discussions", () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 900);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const workspace = document.querySelector('[aria-label="Workspace"]');
          if (!(workspace instanceof HTMLElement)) {
            return false;
          }
          const bounds = workspace.getBoundingClientRect();
          return (
            window.innerWidth > 1100 &&
            getComputedStyle(workspace).display !== "none" &&
            bounds.width > 0 &&
            bounds.height > 0
          );
        }),
      {
        timeout: 5_000,
        timeoutMsg: "Normal viewport did not finish applying",
      },
    );
  });

  it("creates a Discussion and sends a message without activating an Agent", async () => {
    await waitForWorkspace();
    await createAgent("Ada");
    await $("aria/Discussions").click();
    await $("aria/New discussion").click();

    const form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Repository work");
    await form.$("aria/Ada").click();
    await form.$("button=Create").click();

    await expect($("h2=Repository work")).toBeDisplayed();
    const discussionTechnicalDetails = await $("summary=Technical details");
    await discussionTechnicalDetails.click();
    await expect($("aria/Copy Discussion ID")).toBeDisplayed();
    await expect($("aria/Messages")).toHaveText("No messages yet");
    const composer = await $("aria/Send Message");
    const message = await composer.$("aria/Message");
    await message.waitUntil(() => message.isFocused());
    await message.setValue("Document the release checklist.");
    await composer.$("button=Send").click();

    await expect($("p=Document the release checklist.")).toBeDisplayed();
    const technicalDetails = await $$("summary=Technical details");
    await technicalDetails[1].click();
    await expect($("aria/Copy Message ID")).toBeDisplayed();
    const discussion = await $("aria/Open Repository work");
    await browser.waitUntil(async () =>
      (await discussion.getText()).includes("1 message"),
    );
    await expect($$(".mention-status")).toBeElementsArrayOfSize(0);
    await $("aria/Members").click();
    await expect($("aria/Open Ada")).toHaveText(
      expect.stringContaining("IDLE"),
    );
  });

  it("keeps crowded member status avatars stable in a narrow viewport", async () => {
    await waitForWorkspace();

    const agentNames = Array.from(
      { length: 24 },
      (_, index) => `Crowd${String(index + 1).padStart(2, "0")}`,
    );
    for (const name of agentNames) {
      await createCrowdAgent(name);
    }

    await browser.setWindowSize(1200, 760);
    await $("aria/Discussions").click();
    await $("aria/New discussion").click();
    const form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Crowded layout");
    for (const name of agentNames) {
      await form.$(`aria/${name}`).click();
    }
    await form.$("button=Create").click();
    await expect($("h2=Crowded layout")).toBeDisplayed();

    const avatars = await $$(".discussion-member-avatar");
    const agentAvatars = await $$("[data-agent-status]");
    await expect(avatars).toBeElementsArrayOfSize(agentNames.length + 1);
    await expect(agentAvatars).toBeElementsArrayOfSize(agentNames.length);

    const layout = await browser.execute(() => {
      const container = document.querySelector(".discussion-member-avatars");
      const header = container?.closest("header");
      if (
        !(container instanceof HTMLElement) ||
        !(header instanceof HTMLElement)
      ) {
        return null;
      }
      const directItems = [...container.children].filter(
        (item) => !item.classList.contains("sr-only"),
      );
      const targets = directItems.map((item) =>
        item.classList.contains("discussion-member-avatar")
          ? item
          : item.querySelector(".discussion-member-avatar"),
      );
      if (targets.some((target) => !(target instanceof HTMLElement))) {
        return null;
      }
      const headerRect = header.getBoundingClientRect();
      const itemRects = directItems.map((item) => item.getBoundingClientRect());
      const targetRects = targets.map((target) =>
        target.getBoundingClientRect(),
      );
      const markRects = [
        ...container.querySelectorAll(".discussion-member-status-mark"),
      ].map((mark) => mark.getBoundingClientRect());
      const withinHeader = (rect, inset = 0) =>
        rect.left - inset >= headerRect.left - 0.5 &&
        rect.right + inset <= headerRect.right + 0.5 &&
        rect.top - inset >= headerRect.top - 0.5 &&
        rect.bottom + inset <= headerRect.bottom + 0.5;

      return {
        directItemsFixed: itemRects.every(
          (rect) =>
            Math.abs(rect.width - 28) < 0.1 && Math.abs(rect.height - 28) < 0.1,
        ),
        targetsFixed: targetRects.every(
          (rect) =>
            Math.abs(rect.width - 28) < 0.1 && Math.abs(rect.height - 28) < 0.1,
        ),
        wrapped:
          new Set(itemRects.map((rect) => Math.round(rect.top))).size > 1,
        marksVisible: markRects.every((rect) => withinHeader(rect)),
        focusRingsVisible: targetRects.every((rect) => withinHeader(rect, 3)),
        keyboardTargetsReachable: targets
          .filter((target) => target.matches("[data-agent-status]"))
          .every(
            (target) =>
              target instanceof HTMLButtonElement &&
              target.tabIndex === 0 &&
              !target.disabled,
          ),
        wrappedAgentIndex:
          targetRects.findIndex(
            (rect, index) => index > 0 && rect.top > targetRects[0].top + 1,
          ) - 1,
        headerHasNoHorizontalOverflow: header.scrollWidth <= header.clientWidth,
        pageHasNoHorizontalOverflow:
          document.body.scrollWidth <= document.body.clientWidth,
        flexWrap: getComputedStyle(container).flexWrap,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout.directItemsFixed).toBe(true);
    expect(layout.targetsFixed).toBe(true);
    expect(layout.wrapped).toBe(true);
    expect(layout.marksVisible).toBe(true);
    expect(layout.focusRingsVisible).toBe(true);
    expect(layout.keyboardTargetsReachable).toBe(true);
    expect(layout.headerHasNoHorizontalOverflow).toBe(true);
    expect(layout.pageHasNoHorizontalOverflow).toBe(true);
    expect(layout.flexWrap).toBe("wrap");

    expect(layout.wrappedAgentIndex).toBeGreaterThanOrEqual(0);
    await browser.execute((index) => {
      document.querySelectorAll("[data-agent-status]")[index]?.focus();
    }, layout.wrappedAgentIndex);
    await expect(agentAvatars[layout.wrappedAgentIndex]).toBeFocused();
    await expect(agentAvatars[layout.wrappedAgentIndex]).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Agent status:"),
    );
  }).timeout(180_000);

  it("derives a Mention from manually typed exact @Name text", async () => {
    await waitForWorkspace();
    await createAgent("Lin");
    await $("aria/Discussions").click();
    await $("aria/New discussion").click();

    const form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Direct mention");
    await form.$("aria/Lin").click();
    await form.$("button=Create").click();

    const composer = await $("aria/Send Message");
    await composer.$("aria/Message").setValue("@Lin review this directly.");
    await composer.$("button=Send").click();

    await expect($("p=@Lin review this directly.")).toBeDisplayed();
    await expect($(".mention-status")).toHaveText(
      expect.stringContaining("@Lin"),
    );
  });
});
