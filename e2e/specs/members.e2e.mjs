import { $, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { createAgent, waitForWorkspace } from "../support/app.mjs";

describe("Members", () => {
  it("creates an Agent and opens its details", async () => {
    await waitForWorkspace();
    const details = await createAgent("Ada");

    await expect($("aria/Member list")).toBeDisplayed();
    await expect($("aria/Open You")).toBeDisplayed();
    await expect($("aria/Open Ada")).toHaveAttribute("aria-current", "page");
    await expect(details.$("h2=Ada")).toBeDisplayed();
    await expect(details).toHaveText(expect.stringContaining("IDLE"));
    await expect(details).toHaveText(expect.stringContaining("Member ID"));
  });
});
