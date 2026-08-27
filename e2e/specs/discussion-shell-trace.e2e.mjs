import { writeFileSync } from "node:fs";
import { $, browser, expect } from "@wdio/globals";
import { before, describe, it } from "mocha";

const output = process.env.HUDDOL_TRACE_OUTPUT;

async function createLocalAgent(name) {
  await $("aria/Members").click();
  const button = await $('button[aria-label="New Agent"]');
  await button.waitForEnabled();
  await button.click();
  const form = await $('form[aria-label="Create Agent"]');
  await form.waitForDisplayed();
  await form.$("#agent-name").setValue(name);
  await form.$("button=Create").click();
  await $(`aria/${name} details`).waitForDisplayed();
}

async function createDiscussion(topic, members) {
  await $("aria/Discussions").click();
  const button = await $("aria/New discussion");
  await button.waitForEnabled();
  await button.click();
  const form = await $("aria/Create Discussion");
  await form.waitForDisplayed();
  await form.$("#discussion-topic").setValue(topic);
  for (const member of members) await form.$(`aria/${member}`).click();
  await form.$("button=Create").click();
  await expect($(`h2=${topic}`)).toBeDisplayed();
}

async function trace(label) {
  return browser.executeAsync((traceLabel, done) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return null;
          const value = element.getBoundingClientRect();
          return Object.fromEntries(
            ["x", "y", "top", "right", "bottom", "left", "width", "height"].map(
              (key) => [key, value[key]],
            ),
          );
        };
        const metrics = (selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return null;
          const style = getComputedStyle(element);
          return {
            rect: rect(selector),
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
            overflow: style.overflow,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            transform: style.transform,
            translate: style.translate,
            zoom: style.zoom,
          };
        };
        const log = document.querySelector(".message-log");
        const firstVisible = [
          ...document.querySelectorAll("[data-message-id]"),
        ].find((element) => {
          const item = element.getBoundingClientRect();
          const viewport = log?.getBoundingClientRect();
          return (
            viewport && item.bottom > viewport.top && item.top < viewport.bottom
          );
        });
        const active = document.activeElement;
        done({
          label: traceLabel,
          nodes: {
            html: metrics("html"),
            body: metrics("body"),
            root: metrics("#root"),
            appShell: metrics(".app-shell"),
            sidebar: metrics(".app-sidebar"),
            workspace: metrics(".workspace-main"),
            discussions: metrics(".discussions-workspace"),
            detail: metrics(".discussion-detail-pane"),
            pane: metrics(".discussion-pane"),
            header: metrics(".discussion-pane > header"),
            title: metrics(".discussion-title"),
            avatarStrip: metrics(".discussion-member-avatars"),
            messageLog: metrics(".message-log"),
            composer: metrics('form[aria-label="Send Message"]'),
          },
          message:
            log instanceof HTMLElement
              ? {
                  scrollTop: log.scrollTop,
                  clientHeight: log.clientHeight,
                  scrollHeight: log.scrollHeight,
                  firstVisibleRect:
                    firstVisible?.getBoundingClientRect().toJSON?.() ?? null,
                }
              : null,
          focus:
            active instanceof HTMLElement
              ? {
                  tag: active.tagName,
                  id: active.id,
                  ariaLabel: active.getAttribute("aria-label"),
                  navigationKey: active.dataset.memberNavigationKey ?? null,
                }
              : null,
          viewport: { innerWidth, innerHeight, devicePixelRatio },
        });
      }),
    );
  }, label);
}

describe("Discussion shell trace", () => {
  before(async () => {
    await $("aria/Workspace").waitForDisplayed({ timeout: 60_000 });
  });

  it("captures A B C and A return", async () => {
    await browser.setWindowSize(1200, 760);
    const names = Array.from(
      { length: 24 },
      (_, i) => `Trace${String(i + 1).padStart(2, "0")}`,
    );
    for (const name of names) await createLocalAgent(name);
    await createDiscussion("Trace A", [names[0]]);
    await createDiscussion("Trace B", names);
    await createDiscussion("Trace C", [names[0]]);
    await $("aria/Open Trace A").click();
    const A = await trace("A");
    await $("aria/Open Trace B").click();
    const B = await trace("B");
    await $("aria/Open Trace C").click();
    const composer = await $("aria/Message");
    for (let i = 0; i < 20; i += 1) {
      await composer.setValue(
        `Long fixture message ${i + 1} ${"content ".repeat(30)}`,
      );
      await $("aria/Send Message").$("button=Send").click();
    }
    await composer.click();
    await browser.execute(() => {
      const log = document.querySelector(".message-log");
      log.scrollTop = 1000;
      log.dispatchEvent(new Event("scroll"));
    });
    const C = await trace("C");
    await $("aria/Open Trace A").click();
    const A2 = await trace("A2");
    await $("aria/Open Trace C").click();
    const C2 = await trace("C2");
    const data = { A, B, C, A2, C2 };
    const stableRectKeys = [
      "appShell",
      "sidebar",
      "workspace",
      "discussions",
      "detail",
      "pane",
      "header",
      "avatarStrip",
      "messageLog",
      "composer",
    ];
    for (const current of [B, C, A2, C2]) {
      for (const key of stableRectKeys) {
        for (const dimension of ["x", "y", "width", "height"]) {
          expect(
            Math.abs(
              current.nodes[key].rect[dimension] - A.nodes[key].rect[dimension],
            ),
          ).toBeLessThanOrEqual(0.5);
        }
      }
      expect(current.nodes.root.rect.x).toBe(0);
      expect(current.nodes.root.scrollWidth).toBe(
        current.nodes.root.clientWidth,
      );
      expect(current.nodes.body.scrollWidth).toBe(
        current.nodes.body.clientWidth,
      );
    }
    expect(B.nodes.avatarStrip.scrollWidth).toBeGreaterThan(
      B.nodes.avatarStrip.clientWidth,
    );
    expect(C2.message.scrollTop).toBe(C.message.scrollTop);
    expect(C2.focus).toEqual(C.focus);
    console.log(`HUDDOL_LAYOUT_TRACE ${JSON.stringify(data)}`);
    if (output) writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
  }).timeout(300_000);
});
