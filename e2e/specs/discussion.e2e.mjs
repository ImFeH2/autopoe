import { $, $$, browser, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { createAgent, waitForWorkspace } from "../support/app.mjs";

describe("Discussions", () => {
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
    await expect($("aria/Messages")).toHaveText("No messages yet");
    const composer = await $("aria/Send Message");
    const message = await composer.$("aria/Message");
    await message.waitUntil(() => message.isFocused());
    await message.setValue("Document the release checklist.");
    await composer.$("button=Send").click();

    await expect($("p=Document the release checklist.")).toBeDisplayed();
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
});
