import { $, browser, expect } from "@wdio/globals";
import { beforeEach, describe, it } from "mocha";

async function createAgent(name) {
  await $("aria/Members").click();
  await $('button[aria-label="New Agent"]').click();
  const form = await $('form[aria-label="Create Agent"]');
  await form.waitForDisplayed();
  await form.$("#agent-name").setValue(name);
  await form.$("button=Create").click();
  await $(`aria/${name} details`).waitForDisplayed();
}

describe("Human mentions", () => {
  beforeEach(async () => {
    await browser.setWindowSize(1440, 900);
  });

  it("renames the current Human and keeps Human delivery outside Agent state", async () => {
    await $("aria/Members").click();
    await $("aria/Open You").click();
    const rename = await $("aria/Rename current Human");
    await rename.$("#human-formal-name").setValue("Owner");
    await rename.$("button=Save name").click();
    await $("aria/Owner details").waitForDisplayed();

    await createAgent("HumanPingAgent");
    await $("aria/Discussions").click();
    await $("aria/New discussion").click();
    const create = await $("aria/Create Discussion");
    await create.$("#discussion-topic").setValue("Human mention delivery");
    await create.$("aria/HumanPingAgent").click();
    await create.$("button=Create").click();

    const composer = await $("aria/Send Message");
    const message = await composer.$("aria/Message");
    await message.setValue("@Own");
    const ownerCandidate = await $("aria/Mention Owner");
    await ownerCandidate.waitForDisplayed();
    await expect(ownerCandidate).toHaveText(expect.stringContaining("Human"));
    await expect(ownerCandidate).toHaveText(
      expect.stringContaining("In Discussion"),
    );
    await ownerCandidate.click();
    await composer.$("button=Send").click();
    await expect($("aria/Human mention notifications")).toHaveText(
      expect.stringContaining("0 unread"),
    );

    await message.setValue(
      "@HumanPingAgent Reply with exactly @Owner and no other words.",
    );
    await composer.$("button=Send").click();
    const notification = await $(
      'section[aria-label="Human mention notifications"] button.is-unread',
    );
    await notification.waitForDisplayed({ timeout: 120_000 });
    await expect(notification).toHaveText(expect.stringContaining("Unread"));
    await notification.click();

    const notifiedMessage = await $("[data-message-id]:focus");
    await notifiedMessage.waitForExist();
    await expect(notifiedMessage).toHaveText(expect.stringContaining("@Owner"));
    await expect($("aria/Human mention notifications")).toHaveText(
      expect.stringContaining("0 unread"),
    );
  }).timeout(180_000);
});
