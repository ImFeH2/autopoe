import { $, expect } from "@wdio/globals";

export async function waitForWorkspace() {
  const workspace = await $("aria/Workspace");
  await workspace.waitForDisplayed({ timeout: 15_000 });
  await expect($("h1=Flowent")).toBeDisplayed();
}

export async function createAgent(name) {
  await $("aria/Members").click();
  await $("aria/New Agent").click();
  const form = await $("aria/Create Agent");
  await form.waitForDisplayed();
  const input = await form.$("#agent-name");
  await expect(input).toBeFocused();
  await input.setValue(name);
  await form.$("button=Create").click();
  const details = await $(`aria/${name} details`);
  await details.waitForDisplayed();
  return details;
}
