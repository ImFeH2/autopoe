import { $, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { waitForWorkspace } from "../support/app.mjs";

describe("Execution settings", () => {
  it("offers the detected WSL environment and saves it for restart", async function () {
    if (process.platform !== "win32") {
      this.skip();
    }
    await waitForWorkspace();
    await $("aria/Settings").click();
    const form = await $("aria/Execution settings");
    await form.waitForDisplayed();
    await expect(form.$("aria/Windows")).toBeDisplayed();
    await expect(
      form.$("span=Locations writable by Everyone may also be changed."),
    ).toBeDisplayed();
    const directory = process.env.HUDDOL_E2E_WRITABLE_DIRECTORY;
    if (!directory) {
      throw new Error("HUDDOL_E2E_WRITABLE_DIRECTORY is required");
    }
    const directoryInput = await form.$("aria/Writable directory");
    await directoryInput.setValue(directory);
    await form.$("button=Add").click();
    await expect(form.$(`aria/Remove ${directory}`)).toBeDisplayed();
    const wsl = await form.$("button*=WSL");
    await wsl.waitForDisplayed();
    await wsl.click();
    await expect(
      form.$("span=Locations writable by Everyone may also be changed."),
    ).toBeDisplayed();
    const save = await form.$("button=Save execution");
    await save.waitForEnabled();
    await save.click();
    await expect(form.$("aria/Restart required")).toBeDisplayed();
  });
});
