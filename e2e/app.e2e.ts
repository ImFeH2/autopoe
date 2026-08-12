import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $, browser, expect } from "@wdio/globals";

const artifactsDir = resolve("artifacts", "desktop");
const agentWorkDir = resolve(artifactsDir, "e2e-agent-work");
const agentWorkFile = resolve(agentWorkDir, "input.txt");

async function createDiscussion(topic: string) {
  await $("#topic").setValue(topic);
  await $("#discussion-member-2").click();
  await $("form[aria-label='Create Discussion'] button").click();
  await expect($(`h2=${topic}`)).toExist();
}

async function sendMessage(body: string, mentionAgent = false) {
  if (mentionAgent) {
    await $("#message-mention-2").click();
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
    await expect($("[aria-label='Discussions']")).toHaveText("No discussions");

    const windows = await browser.tauri.listWindows();
    expect(windows).toContain("main");
  });

  it("creates and switches Discussions with scoped Message IDs", async () => {
    await $("[aria-label='Agent name']").setValue("Ada");
    await $("form[aria-label='Create Agent'] button").click();
    await expect($("aside")).toHaveText(expect.stringContaining("Ada"));
    await expect($("aside")).toHaveText(expect.stringContaining("IDLE · 2"));

    await createDiscussion("Ship the first slice");
    await expect($("p=You, Ada")).toExist();
    await sendMessage(
      "E2E_REPOSITORY_TASK: inspect and update the controlled fixture.",
      true,
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("@Ada · ACKED"),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Ada used exec and patch. status=0 verify=0"),
    );
    await expect($("aside")).toHaveText(expect.stringContaining("IDLE · 2"));
    expect(await readFile(agentWorkFile, "utf8")).toBe("after\n");

    await sendMessage("Human follow-up without a mention.");
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("MESSAGE 3"),
    );

    await createDiscussion("Review the first slice");
    await sendMessage("Second Discussion message one.");
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("MESSAGE 1"),
    );
    await expect($("[role='log']")).not.toHaveText(
      expect.stringContaining("MESSAGE 2"),
    );

    await $("button*=Ship the first slice").click();
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("E2E_REPOSITORY_TASK:"),
    );
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("MESSAGE 3"),
    );
    await expect($("[role='log']")).not.toHaveText(
      expect.stringContaining("Second Discussion message one."),
    );

    await $("button*=Review the first slice").click();
    await expect($("[role='log']")).toHaveText(
      expect.stringContaining("Second Discussion message one."),
    );
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
