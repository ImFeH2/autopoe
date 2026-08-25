import { $, $$, browser, expect } from "@wdio/globals";
import { before, beforeEach, describe, it } from "mocha";

async function createLocalAgent(name) {
  await $("aria/Members").click();
  const newAgent = await $('button[aria-label="New Agent"]');
  await newAgent.waitForExist();
  await newAgent.waitForDisplayed();
  await newAgent.waitForEnabled();
  await newAgent.click();
  const form = await $('form[aria-label="Create Agent"]');
  await form.waitForDisplayed();
  await form.$("#agent-name").setValue(name);
  await form.$("button=Create").click();
  await $(`aria/${name} details`).waitForDisplayed();
}

async function readMemberNavigationKey(element) {
  const key = await element.getAttribute("data-member-navigation-key");
  expect(key).toBeTruthy();
  return key;
}

async function findCurrentMemberNavigationTrigger(key) {
  const trigger = await $(`[data-member-navigation-key="${key}"]`);
  await trigger.waitForExist();
  await trigger.waitForDisplayed();
  return trigger;
}

describe("Discussions", () => {
  before(async () => {
    await expect($("aria/Workspace")).toBeDisplayed();
    for (const selector of [
      'button[aria-label="Members"]',
      'button[aria-label="Discussions"]',
    ]) {
      const navigationButton = await $(selector);
      await navigationButton.waitForExist();
      await expect(navigationButton).toBeDisplayed();
      await expect(navigationButton).toBeEnabled();
    }
  });

  beforeEach(async () => {
    await browser.setWindowSize(1440, 900);
  });

  it("creates a Discussion and sends a message without activating an Agent", async () => {
    await createLocalAgent("Ada");
    await $("aria/Discussions").click();
    await $("aria/New discussion").click();

    const form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Repository work");
    await form.$("aria/Ada").click();
    await form.$("button=Create").click();

    await expect($("h2=Repository work")).toBeDisplayed();
    await expect($$("summary=Technical details")).toBeElementsArrayOfSize(0);
    await expect($$("aria/Copy Discussion ID")).toBeElementsArrayOfSize(0);
    await expect($("aria/Messages")).toHaveText("No messages yet");
    const composer = await $("aria/Send Message");
    const message = await composer.$("aria/Message");
    await message.waitUntil(() => message.isFocused());
    await message.setValue("Document the release checklist.");
    await composer.$("button=Send").click();

    await expect($("p=Document the release checklist.")).toBeDisplayed();
    await expect($$("summary=Technical details")).toBeElementsArrayOfSize(0);
    await expect($$("aria/Copy Discussion ID")).toBeElementsArrayOfSize(0);
    await expect($$("aria/Copy Message ID")).toBeElementsArrayOfSize(0);
    await expect($$("aria/Copy Sender ID")).toBeElementsArrayOfSize(0);
    await expect($$("button=Copy ID")).toBeElementsArrayOfSize(0);
    const discussion = await $("aria/Open Repository work");
    await browser.waitUntil(async () =>
      (await discussion.getText()).includes("1 message"),
    );
    await expect($$(".mention-status")).toBeElementsArrayOfSize(0);
    const persistedTimestamp = await $(".message-timestamp time").getAttribute(
      "datetime",
    );
    expect(persistedTimestamp).toMatch(/Z$/);

    await browser.setWindowSize(960, 760);
    const compactLayout = await browser.execute(() => {
      const meta = document.querySelector(".message-meta");
      const sender = meta?.querySelector("strong");
      const bubble = document.querySelector(".message-bubble");
      if (!(meta instanceof HTMLElement) || !(sender instanceof HTMLElement)) {
        return null;
      }
      sender.textContent =
        "Extremely Long Sender Identity That Must Wrap Without Horizontal Overflow";
      return {
        metaHasNoHorizontalOverflow: meta.scrollWidth <= meta.clientWidth,
        bubbleHasNoHorizontalOverflow:
          bubble instanceof HTMLElement &&
          bubble.scrollWidth <= bubble.clientWidth,
        pageStaysWithinApplicationMinimum:
          document.documentElement.scrollWidth <=
          Math.max(document.documentElement.clientWidth, 960),
        flexWrap: getComputedStyle(meta).flexWrap,
        timestampWhiteSpace: getComputedStyle(
          meta.querySelector(".message-timestamp"),
        ).whiteSpace,
      };
    });
    expect(compactLayout).not.toBeNull();
    expect(compactLayout.metaHasNoHorizontalOverflow).toBe(true);
    expect(compactLayout.bubbleHasNoHorizontalOverflow).toBe(true);
    expect(compactLayout.pageStaysWithinApplicationMinimum).toBe(true);
    expect(compactLayout.flexWrap).toBe("wrap");
    expect(compactLayout.timestampWhiteSpace).toBe("nowrap");

    await $("aria/Members").click();
    await expect($("aria/Open Ada")).toHaveText(
      expect.stringContaining("IDLE"),
    );
  });

  it("keeps crowded member avatars in a fixed scrolling header", async () => {
    const agentNames = Array.from(
      { length: 24 },
      (_, index) => `Crowd${String(index + 1).padStart(2, "0")}`,
    );
    for (const name of agentNames) {
      await createLocalAgent(name);
    }

    await browser.setWindowSize(1200, 760);
    await $("aria/Discussions").click();
    const newDiscussion = await $("aria/New discussion");
    await newDiscussion.waitForEnabled();
    await newDiscussion.click();
    let form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Sparse layout");
    await form.$(`aria/${agentNames[0]}`).click();
    await form.$("button=Create").click();
    await expect($("h2=Sparse layout")).toBeDisplayed();

    await newDiscussion.click();
    form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Crowded layout");
    for (const name of agentNames) {
      await form.$(`aria/${name}`).click();
    }
    await form.$("button=Create").click();
    await expect($("h2=Crowded layout")).toBeDisplayed();

    async function readGeometry() {
      return browser.executeAsync((done) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const readRect = (selector) => {
              const element = document.querySelector(selector);
              if (!(element instanceof HTMLElement)) return null;
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            };
            const container = document.querySelector(
              ".discussion-member-avatars",
            );
            const items = container
              ? [...container.children].filter(
                  (item) => !item.classList.contains("sr-only"),
                )
              : [];
            done({
              shell: readRect(".app-shell"),
              sidebar: readRect(".app-sidebar"),
              workspace: readRect(".workspace-main"),
              detail: readRect(".discussion-detail-pane"),
              header: readRect(".discussion-pane > header"),
              title: readRect(".discussion-title"),
              avatars: readRect(".discussion-member-avatars"),
              messageLog: readRect(".message-log"),
              composer: readRect('form[aria-label="Send Message"]'),
              rowTops: items.map((item) => item.getBoundingClientRect().top),
              avatarScrollWidth:
                container instanceof HTMLElement ? container.scrollWidth : 0,
              avatarClientWidth:
                container instanceof HTMLElement ? container.clientWidth : 0,
              flexWrap:
                container instanceof HTMLElement
                  ? getComputedStyle(container).flexWrap
                  : null,
              rootHasNoOverflow:
                document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth &&
                document.body.scrollWidth <= document.body.clientWidth,
            });
          }),
        );
      });
    }

    await $("aria/Open Sparse layout").click();
    const sparse = await readGeometry();
    await $("aria/Open Crowded layout").click();
    await $(".discussion-member-avatars").waitForDisplayed();
    const agentAvatars = await $$('[data-member-identity="agent"]');
    expect(
      await browser.execute(
        () =>
          [
            ...document.querySelectorAll(".discussion-member-avatars > *"),
          ].filter((item) => !item.classList.contains("sr-only")).length,
      ),
    ).toBe(agentNames.length + 1);
    await expect(agentAvatars).toBeElementsArrayOfSize(agentNames.length);
    const crowded = await readGeometry();
    expect(sparse).not.toBeNull();
    expect(crowded).not.toBeNull();
    for (const key of [
      "shell",
      "sidebar",
      "workspace",
      "detail",
      "header",
      "messageLog",
      "composer",
    ]) {
      expect(crowded[key]).toEqual(sparse[key]);
    }
    expect(crowded.title.y).toBe(sparse.title.y);
    expect(new Set(crowded.rowTops.map((top) => Math.round(top))).size).toBe(1);
    expect(crowded.avatarScrollWidth).toBeGreaterThan(
      crowded.avatarClientWidth,
    );
    expect(crowded.flexWrap).toBe("nowrap");
    expect(crowded.rootHasNoOverflow).toBe(true);

    const lastAgentAvatar = agentAvatars.at(-1);
    await browser.execute(() => {
      const targets = document.querySelectorAll(
        '[data-member-identity="agent"]',
      );
      targets[targets.length - 1]?.focus();
    });
    await expect(lastAgentAvatar).toBeFocused();
    const focusedLayout = await browser.execute(() => {
      const container = document.querySelector(".discussion-member-avatars");
      const target = document.activeElement;
      if (
        !(container instanceof HTMLElement) ||
        !(target instanceof HTMLElement)
      ) {
        return null;
      }
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      return {
        scrollLeft: container.scrollLeft,
        targetVisible:
          targetRect.left >= containerRect.left - 0.5 &&
          targetRect.right <= containerRect.right + 0.5,
      };
    });
    expect(focusedLayout.scrollLeft).toBeGreaterThan(0);
    expect(focusedLayout.targetVisible).toBe(true);
    await expect(lastAgentAvatar).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Agent status:"),
    );
  }).timeout(180_000);

  it("derives a Mention from manually typed exact @Name text", async () => {
    await createLocalAgent("Lin");
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
  it("navigates structured identities and preserves unavailable references", async () => {
    await createLocalAgent("NavAda");
    await createLocalAgent("NavLin");
    await createLocalAgent("NavGone");

    await $("aria/Discussions").click();
    await $("aria/New discussion").click();
    const form = await $("aria/Create Discussion");
    await form.waitForDisplayed();
    await form.$("#discussion-topic").setValue("Identity navigation");
    await form.$("aria/NavAda").click();
    await form.$("button=Create").click();
    await expect($("h2=Identity navigation")).toBeDisplayed();

    const humanAvatar = await $("aria/You, Human");
    const humanNavigationKey = await readMemberNavigationKey(humanAvatar);
    await browser.execute(() => {
      document.querySelector('[aria-label="You, Human"]')?.focus();
    });
    await expect(humanAvatar).toBeFocused();
    expect(
      await browser.execute(() => {
        const target = document.querySelector('[aria-label="You, Human"]');
        return (
          target instanceof HTMLButtonElement &&
          target.tabIndex === 0 &&
          !target.disabled
        );
      }),
    ).toBe(true);
    // Click exercises navigation/focus state only; keyboard activation is reviewed physically.
    await humanAvatar.click();
    const humanDetails = await $("aria/You details");
    await humanDetails.waitForDisplayed();
    await expect(humanDetails).toHaveText(expect.stringContaining("Overview"));
    await expect(humanDetails).toHaveText(expect.stringContaining("Human"));
    await expect(humanDetails).not.toHaveText(
      expect.stringContaining("Member ID"),
    );
    const humanBack = await $("aria/Back to Identity navigation discussion");
    await expect(humanBack).toBeFocused();
    await humanBack.click();
    await expect($("h2=Identity navigation")).toBeDisplayed();
    const restoredHumanAvatar =
      await findCurrentMemberNavigationTrigger(humanNavigationKey);
    await expect(restoredHumanAvatar).toBeFocused();

    const agentAvatar = await $("aria/NavAda, Agent status: Idle");
    const agentNavigationKey = await readMemberNavigationKey(agentAvatar);
    await browser.execute(() => {
      document
        .querySelector('[aria-label="NavAda, Agent status: Idle"]')
        ?.focus();
    });
    await expect(agentAvatar).toBeFocused();
    await agentAvatar.click();
    await $("aria/NavAda details").waitForDisplayed();
    await expect($("[role=tab][aria-selected=true]")).toHaveText("Overview");
    const agentBack = await $("aria/Back to Identity navigation discussion");
    await expect(agentBack).toBeFocused();
    await agentBack.click();
    await expect($("h2=Identity navigation")).toBeDisplayed();
    const restoredAgentAvatar =
      await findCurrentMemberNavigationTrigger(agentNavigationKey);
    await expect(restoredAgentAvatar).toBeFocused();

    const composer = await $("aria/Send Message");
    await composer
      .$("aria/Message")
      .setValue(
        "@NavAda ask @NavLin and @NavLin with @NavGone; @Plain stays text.",
      );
    await composer.$("button=Send").click();

    const adaReference = await $("aria/Open NavAda in Members");
    const linReferences = await $$("aria/Open NavLin in Members");
    const secondLinReference = linReferences[1];
    const goneReference = await $("aria/Open NavGone in Members");
    await adaReference.waitForDisplayed();
    const adaNavigationKey = await readMemberNavigationKey(adaReference);
    await expect(linReferences).toBeElementsArrayOfSize(2);
    await secondLinReference.waitForDisplayed();
    const secondLinNavigationKey =
      await readMemberNavigationKey(secondLinReference);
    await goneReference.waitForDisplayed();
    await expect($$("aria/Open Plain in Members")).toBeElementsArrayOfSize(0);
    await expect($("p*=Plain stays text")).toBeDisplayed();
    const mentionCount = (await $$(".mention-status")).length;

    await browser.execute(() => {
      document
        .querySelectorAll('[aria-label="Open NavLin in Members"]')[1]
        ?.focus();
    });
    await expect(secondLinReference).toBeFocused();
    await secondLinReference.click();
    await $("aria/NavLin details").waitForDisplayed();
    const mentionBack = await $("aria/Back to Identity navigation discussion");
    await expect(mentionBack).toBeFocused();
    await mentionBack.click();
    await expect($("h2=Identity navigation")).toBeDisplayed();
    const restoredSecondLinReference = await findCurrentMemberNavigationTrigger(
      secondLinNavigationKey,
    );
    await expect(restoredSecondLinReference).toBeFocused();
    await expect($$(".mention-status")).toBeElementsArrayOfSize(mentionCount);

    const currentAdaReference =
      await findCurrentMemberNavigationTrigger(adaNavigationKey);
    const currentAdaNavigationKey =
      await readMemberNavigationKey(currentAdaReference);
    expect(currentAdaNavigationKey).toBe(adaNavigationKey);
    await currentAdaReference.click();
    const fallbackBack = await $("aria/Back to Identity navigation discussion");
    await expect(fallbackBack).toBeFocused();
    await browser.execute(() => {
      const observer = new MutationObserver(() => {
        const trigger = document.querySelector(
          '[aria-label="Open NavAda in Members"]',
        );
        if (trigger) {
          trigger.remove();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await fallbackBack.click();
    const discussionTitle = await $("h2=Identity navigation");
    await expect(discussionTitle).toBeFocused();

    await $("aria/Open NavGone in Members").click();
    await $("aria/NavGone details").waitForDisplayed();
    await $("aria/Delete NavGone").click();
    const deleteDialog = await $("aria/Delete Agent");
    await deleteDialog.waitForDisplayed();
    await deleteDialog.$("input").setValue("NavGone");
    await deleteDialog.$("button=Delete").click();

    await $("aria/Discussions").click();
    await $("aria/Open Identity navigation").click();
    const deletedReference = await $(".mention-reference--deleted");
    await deletedReference.waitForDisplayed();
    await expect(deletedReference).toHaveAttribute(
      "aria-label",
      "@NavGone, Deleted member",
    );
    await expect($$("aria/Open NavGone in Members")).toBeElementsArrayOfSize(0);
    await expect($$(".message-avatar button")).toBeElementsArrayOfSize(0);
  });
});
