import { $, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { waitForWorkspace } from "../support/app.mjs";

describe("Huddol startup", () => {
  it("opens the real desktop application in its initial state", async () => {
    await waitForWorkspace();

    await expect($("aria/Discussions")).toHaveAttribute("aria-current", "page");
    await expect($("aria/Discussion list")).toBeDisplayed();
    await expect($(".discussion-list-empty")).toHaveText("No discussions");
    await expect($("aria/New discussion")).toBeDisabled();
    await expect($("h2=Create an Agent first")).toBeDisplayed();
  });
});
