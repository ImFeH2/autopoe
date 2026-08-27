import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { createAgent, waitForWorkspace } from "../support/app.mjs";

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function agentId(database, name) {
  const value = execFileSync("sqlite3", [
    database,
    `SELECT id FROM members WHERE type = 'agent' AND name = ${sqlString(name)};`,
  ])
    .toString()
    .trim();
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Could not resolve fixture Agent ${name}`);
  }
  return Number(value);
}

function completedRun(agent, sequence, content) {
  const timestamp = `2026-08-22T08:${String(sequence).padStart(2, "0")}:00+00:00`;
  const messages = [
    {
      kind: "response",
      parts: [{ content, part_kind: "text" }],
      timestamp,
    },
  ];
  return `(
    ${agent},
    ${sequence},
    ${sqlString(`layout-${agent}-${sequence}`)},
    'completed',
    ${sqlString(timestamp)},
    ${sqlString(timestamp)},
    '{"mentions":[]}',
    ${sqlString(JSON.stringify(messages))},
    NULL,
    NULL
  )`;
}

function seedHistory(database, shortAgent, longAgent) {
  const tallEntry = Array.from(
    { length: 140 },
    (_, index) => `Scrollable line ${index + 1}`,
  ).join("\n\n");
  const rows = [
    completedRun(shortAgent, 1, "One short history entry."),
    completedRun(longAgent, 1, tallEntry),
    ...Array.from({ length: 30 }, (_, index) =>
      completedRun(longAgent, index + 2, `History entry ${index + 2}.`),
    ),
  ];
  execFileSync("sqlite3", [
    database,
    `BEGIN;
     INSERT INTO agent_runs
       (agent_id, sequence, run_id, status, started_at, completed_at,
        reminder_json, messages_json, usage_json, error)
     VALUES ${rows.join(",")};
     COMMIT;`,
  ]);
}

async function openAgent(name) {
  await $(`aria/Open ${name}`).click();
  const details = await $(`aria/${name} details`);
  await details.waitForDisplayed();
  return details;
}

async function openHistory(name) {
  const details = await openAgent(name);
  await details.$("button=History").click();
  const viewport = await details.$(`aria/${name} history`);
  await viewport.waitForDisplayed();
  await browser.waitUntil(
    async () => (await viewport.getAttribute("aria-busy")) === "false",
  );
  return { details, viewport };
}

async function historyLayout() {
  return browser.execute(() => {
    const details = document.querySelector(".member-agent-detail");
    const body = document.querySelector(".member-detail-body");
    const tabs = document.querySelector(".member-detail-tabs");
    const panel = document.querySelector(".member-detail-panel");
    const history = document.querySelector(".agent-history");
    const header = document.querySelector(".agent-history-header");
    const viewport = document.querySelector(".agent-history-viewport");
    const historyTab = document.querySelector(
      '.member-detail-tabs button[aria-selected="true"]',
    );
    if (
      !(details instanceof HTMLElement) ||
      !(body instanceof HTMLElement) ||
      !(tabs instanceof HTMLElement) ||
      !(panel instanceof HTMLElement) ||
      !(history instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(viewport instanceof HTMLElement) ||
      !(historyTab instanceof HTMLElement)
    ) {
      return null;
    }
    const scrollOwners = [...panel.querySelectorAll("*")]
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          !element.closest("details:not([open])") &&
          ["auto", "scroll"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1
        );
      })
      .map((element) => element.className);
    const documentScroller = document.scrollingElement;
    return {
      bodyOverflow: getComputedStyle(body).overflow,
      detailHeight: details.getBoundingClientRect().height,
      documentScrolls: documentScroller
        ? documentScroller.scrollHeight > documentScroller.clientHeight + 1
        : false,
      headerTop: header.getBoundingClientRect().top,
      historyHeight: history.getBoundingClientRect().height,
      panelHeight: panel.getBoundingClientRect().height,
      scrollOwners,
      tabsTop: tabs.getBoundingClientRect().top,
      viewportAfterHistoryTab: Boolean(
        historyTab.compareDocumentPosition(viewport) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      viewportAriaLabel: viewport.getAttribute("aria-label"),
      viewportClientHeight: viewport.clientHeight,
      viewportOverflowY: getComputedStyle(viewport).overflowY,
      viewportScrollHeight: viewport.scrollHeight,
      viewportTabIndex: viewport.tabIndex,
    };
  });
}

describe("Agent details layout", () => {
  it("keeps Memory and empty, short, and long History states usable", async function () {
    this.timeout(120_000);
    await waitForWorkspace();
    console.info(
      "Embedded WebKit synthetic Tab delivery unavailable; keyboard behavior not claimed as automated PASS or product FAIL.",
    );
    await browser.setWindowSize(1360, 860);

    await createAgent("LayoutEmpty");
    await createAgent("LayoutShort");
    await createAgent("LayoutLong");

    const dataDirectory = process.env.HUDDOL_DATA_DIR;
    if (!dataDirectory) {
      throw new Error("HUDDOL_DATA_DIR is required for layout fixtures");
    }
    const database = join(dataDirectory, "flowent.sqlite3");
    seedHistory(
      database,
      agentId(database, "LayoutShort"),
      agentId(database, "LayoutLong"),
    );

    const emptyDetails = await openAgent("LayoutEmpty");
    await emptyDetails.$("button=Memory").click();
    const memory = await emptyDetails.$("aria/Agent Memory");
    const memoryEmpty = await memory.$(":scope > .agent-section-empty");
    await expect(memoryEmpty).toHaveText("This Agent has no Memory.");
    const widePadding = await memoryEmpty.getCSSProperty("padding-left");
    expect(widePadding.value).toBe("30px");

    const emptyHistory = await openHistory("LayoutEmpty");
    await expect(emptyHistory.viewport).toHaveText("No history");
    const emptyLayout = await historyLayout();
    expect(emptyLayout).not.toBeNull();
    expect(emptyLayout.bodyOverflow).toBe("hidden");
    expect(emptyLayout.documentScrolls).toBe(false);
    expect(
      Math.abs(emptyLayout.historyHeight - emptyLayout.panelHeight),
    ).toBeLessThan(1);

    await browser.setWindowSize(960, 680);
    const compactMemoryDetails = await openAgent("LayoutEmpty");
    await compactMemoryDetails.$("button=Memory").click();
    const compactMemoryEmpty = await compactMemoryDetails.$(
      ".agent-memory > .agent-section-empty",
    );
    await expect(compactMemoryEmpty).toHaveText("This Agent has no Memory.");
    const compactPadding =
      await compactMemoryEmpty.getCSSProperty("padding-left");
    expect(compactPadding.value).toBe("30px");

    const compactEmptyHistory = await openHistory("LayoutEmpty");
    await expect(compactEmptyHistory.viewport).toHaveText("No history");
    const compactEmptyBaseline = await browser.execute(() => {
      const heading = document.querySelector(".agent-history-header h3");
      const empty = document.querySelector(".agent-history-empty");
      if (
        !(heading instanceof HTMLElement) ||
        !(empty instanceof HTMLElement)
      ) {
        return null;
      }
      const emptyStyle = getComputedStyle(empty);
      return {
        emptyContentLeft:
          empty.getBoundingClientRect().left +
          parseFloat(emptyStyle.paddingLeft),
        headingLeft: heading.getBoundingClientRect().left,
      };
    });
    expect(compactEmptyBaseline).not.toBeNull();
    expect(
      Math.abs(
        compactEmptyBaseline.emptyContentLeft -
          compactEmptyBaseline.headingLeft,
      ),
    ).toBeLessThan(1);

    const shortHistory = await openHistory("LayoutShort");
    await expect(
      shortHistory.details.$(".agent-history-block--assistant"),
    ).toBeDisplayed();
    const shortLayout = await historyLayout();
    expect(shortLayout).not.toBeNull();
    expect(shortLayout.viewportScrollHeight).toBeLessThanOrEqual(
      shortLayout.viewportClientHeight + 1,
    );
    const compactTimelineBaseline = await browser.execute(() => {
      const heading = document.querySelector(".agent-history-header h3");
      const firstBlock = document.querySelector(".agent-history-block");
      if (
        !(heading instanceof HTMLElement) ||
        !(firstBlock instanceof HTMLElement)
      ) {
        return null;
      }
      return {
        headingLeft: heading.getBoundingClientRect().left,
        timelineLeft: firstBlock.getBoundingClientRect().left,
      };
    });
    expect(compactTimelineBaseline).not.toBeNull();
    expect(
      Math.abs(
        compactTimelineBaseline.timelineLeft -
          compactTimelineBaseline.headingLeft,
      ),
    ).toBeLessThan(1);

    const longHistory = await openHistory("LayoutLong");
    await browser.waitUntil(
      async () => (await $$(".agent-history-block--assistant")).length >= 31,
    );
    const compactLongLayout = await historyLayout();
    expect(compactLongLayout).not.toBeNull();
    expect(compactLongLayout.viewportOverflowY).toBe("auto");
    expect(compactLongLayout.viewportScrollHeight).toBeGreaterThan(
      compactLongLayout.viewportClientHeight,
    );
    expect(compactLongLayout.scrollOwners).toEqual(["agent-history-viewport"]);
    expect(compactLongLayout.viewportTabIndex).toBe(0);
    expect(compactLongLayout.viewportAriaLabel).toBe("LayoutLong history");
    expect(compactLongLayout.viewportAfterHistoryTab).toBe(true);

    await browser.waitUntil(async () => {
      const metrics = await browser.execute(() => {
        const viewport = document.querySelector(".agent-history-viewport");
        if (!(viewport instanceof HTMLElement)) return null;
        return {
          max: viewport.scrollHeight - viewport.clientHeight,
          top: viewport.scrollTop,
        };
      });
      return (
        metrics !== null &&
        metrics.max > 0 &&
        Math.abs(metrics.max - metrics.top) <= 1
      );
    });
    const initialMetrics = await browser.execute(() => {
      const viewport = document.querySelector(".agent-history-viewport");
      if (!(viewport instanceof HTMLElement)) return null;
      return {
        max: viewport.scrollHeight - viewport.clientHeight,
        top: viewport.scrollTop,
      };
    });
    expect(initialMetrics).not.toBeNull();
    expect(
      Math.abs(initialMetrics.max - initialMetrics.top),
    ).toBeLessThanOrEqual(1);
    expect(initialMetrics.top).toBeGreaterThan(0);

    const fixedBefore = await historyLayout();
    await browser.execute(() => {
      const viewport = document.querySelector(".agent-history-viewport");
      if (viewport instanceof HTMLElement) viewport.scrollTop = 120;
    });
    const fixedAfter = await historyLayout();
    expect(fixedAfter.headerTop).toBeCloseTo(fixedBefore.headerTop, 0);
    expect(fixedAfter.tabsTop).toBeCloseTo(fixedBefore.tabsTop, 0);

    await browser.execute(() => {
      const viewport = document.querySelector(".agent-history-viewport");
      if (viewport instanceof HTMLElement)
        viewport.scrollTop = viewport.scrollHeight;
    });
    const bottom = await browser.execute(() => {
      const viewport = document.querySelector(".agent-history-viewport");
      if (!(viewport instanceof HTMLElement)) return null;
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    });
    expect(bottom).not.toBeNull();
    expect(Math.abs(bottom)).toBeLessThanOrEqual(1);

    await longHistory.details
      .$(".agent-history-block--assistant > summary")
      .click();
    const entryScroller = await longHistory.details.$(
      ".agent-history-block--assistant[open] .agent-history-block-content",
    );
    const entryMetrics = await browser.execute(() => {
      const entry = document.querySelector(
        ".agent-history-block--assistant[open] .agent-history-block-content",
      );
      if (!(entry instanceof HTMLElement)) return null;
      return {
        clientHeight: entry.clientHeight,
        overflow: getComputedStyle(entry).overflow,
        scrollHeight: entry.scrollHeight,
      };
    });
    await expect(entryScroller).toBeDisplayed();
    expect(entryMetrics).not.toBeNull();
    expect(entryMetrics.overflow).toBe("auto");
    expect(entryMetrics.scrollHeight).toBeGreaterThan(
      entryMetrics.clientHeight,
    );

    await browser.execute(() => {
      const viewport = document.querySelector(".agent-history-viewport");
      if (viewport instanceof HTMLElement) viewport.scrollTop = 120;
    });
    await openHistory("LayoutEmpty");
    const switchedEmptyTop = await browser.execute(() => {
      const viewport = document.querySelector(".agent-history-viewport");
      return viewport instanceof HTMLElement ? viewport.scrollTop : null;
    });
    expect(switchedEmptyTop).toBe(0);

    const switchedLong = await openHistory("LayoutLong");
    await browser.waitUntil(async () => {
      const metrics = await browser.execute(() => {
        const viewport = document.querySelector(".agent-history-viewport");
        if (!(viewport instanceof HTMLElement)) return null;
        return {
          max: viewport.scrollHeight - viewport.clientHeight,
          top: viewport.scrollTop,
        };
      });
      return metrics !== null && Math.abs(metrics.max - metrics.top) <= 1;
    });

    await browser.setWindowSize(1360, 860);
    const wideLongLayout = await historyLayout();
    expect(wideLongLayout).not.toBeNull();
    expect(wideLongLayout.documentScrolls).toBe(false);
    expect(wideLongLayout.bodyOverflow).toBe("hidden");
    expect(
      Math.abs(wideLongLayout.historyHeight - wideLongLayout.panelHeight),
    ).toBeLessThan(1);
    expect(wideLongLayout.viewportScrollHeight).toBeGreaterThan(
      wideLongLayout.viewportClientHeight,
    );
    await expect(switchedLong.viewport).toBeDisplayed();
  });
});
