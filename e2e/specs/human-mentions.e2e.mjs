import { createServer } from "node:http";
import { $, browser, expect } from "@wdio/globals";
import { after, before, beforeEach, describe, it } from "mocha";

const mockActivationContracts = new Map();

function mockActivationContract(messageId) {
  let contract = mockActivationContracts.get(messageId);
  if (!contract) {
    contract = {
      ackRequests: 0,
      ackResults: 0,
      sendRequests: 0,
      sendResults: 0,
    };
    mockActivationContracts.set(messageId, contract);
  }
  return contract;
}

const mockModelServer = createServer((request, response) => {
  let rawBody = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    rawBody += chunk;
  });
  request.on("end", () => {
    const payload = JSON.parse(rawBody);
    const reminder = [...payload.messages].reverse().find((message) => {
      const content = message.content;
      return (
        message.role === "user" &&
        typeof content === "string" &&
        content.includes("Here is your Reminder")
      );
    });
    const reminderTarget = /Discussion (\d+), Message (\d+),/.exec(
      reminder?.content ?? "",
    );
    if (!reminderTarget) {
      throw new Error("Mock model request did not contain a Reminder target");
    }
    const discussionId = Number(reminderTarget[1]);
    const messageId = Number(reminderTarget[2]);
    const lastToolCallId = payload.messages.at(-1)?.tool_call_id;
    const contract = mockActivationContract(messageId);
    let nextTool;
    if (lastToolCallId === `call-ack-${messageId}`) {
      contract.ackResults += 1;
      contract.sendRequests += 1;
      nextTool = "send";
    } else if (lastToolCallId === `call-send-${messageId}`) {
      contract.sendResults += 1;
      nextTool = null;
    } else {
      contract.ackRequests += 1;
      nextTool = "ack";
    }
    const finishReason = nextTool === null ? "stop" : "tool_calls";
    const argumentsByTool = {
      ack: {
        action: "ack",
        discussion_id: discussionId,
        message_ids: [messageId],
      },
      send: {
        action: "send",
        discussion_id: discussionId,
        body: "@Owner",
      },
    };
    const delta =
      nextTool === null
        ? { role: "assistant", content: "Done" }
        : {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call-${nextTool}-${messageId}`,
                type: "function",
                function: {
                  name: "discussion",
                  arguments: JSON.stringify(argumentsByTool[nextTool]),
                },
              },
            ],
          };

    if (payload.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "keep-alive",
      });
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-human-mention",
          object: "chat.completion.chunk",
          created: 1,
          model: "huddol-e2e-model",
          choices: [{ index: 0, delta, finish_reason: null }],
        })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-human-mention",
          object: "chat.completion.chunk",
          created: 1,
          model: "huddol-e2e-model",
          choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-human-mention",
        object: "chat.completion",
        created: 1,
        model: "huddol-e2e-model",
        choices: [
          {
            index: 0,
            message: delta,
            finish_reason: finishReason,
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});

let mockModelBaseUrl;

async function configureMockModel() {
  await $("aria/Settings").click();
  const form = await $("aria/Model settings");
  await form.waitForDisplayed();
  const baseUrl = await form.$("#model-base-url");
  const apiKey = await form.$("#model-api-key");
  const model = await form.$("#model-name");
  await baseUrl.waitForEnabled();
  await baseUrl.setValue(mockModelBaseUrl);
  await apiKey.setValue("huddol-e2e-key");
  await model.setValue("huddol-e2e-model");
  const save = await form.$("button=Save model");
  await save.waitForEnabled();
  await save.click();
  await form.$("[role=status]").waitForDisplayed();
}

async function createAgent(name) {
  await $("aria/Members").click();
  await $('button[aria-label="New Agent"]').click();
  const form = await $('form[aria-label="Create Agent"]');
  await form.waitForDisplayed();
  await form.$("#agent-name").setValue(name);
  await form.$("button=Create").click();
  await $(`aria/${name} details`).waitForDisplayed();
}

async function waitForUnreadCount(expected, timeout = 120_000) {
  const notifications = await $("aria/Human mention notifications");
  await browser.waitUntil(
    async () => (await notifications.getText()).includes(`${expected} unread`),
    {
      timeout,
      timeoutMsg: `Expected ${expected} unread Human mentions`,
    },
  );
  return notifications;
}

async function waitForFocusedHighlightedMessage(messageId, timeout = 10_000) {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedMessageId) => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement &&
          active.dataset.messageId === String(expectedMessageId) &&
          active.classList.contains("human-mention-target")
        );
      }, messageId),
    {
      timeout,
      timeoutMsg: `Expected message ${messageId} to be focused and highlighted`,
    },
  );
  return $(`[data-message-id="${messageId}"]`);
}

async function waitForMessageHighlightToClear(messageId) {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedMessageId) => {
        const message = document.querySelector(
          `[data-message-id="${expectedMessageId}"]`,
        );
        return !message?.classList.contains("human-mention-target");
      }, messageId),
    {
      timeout: 5_000,
      timeoutMsg: `Expected message ${messageId} highlight to clear`,
    },
  );
}

async function latestAgentMentionMessageId() {
  const messageId = await browser.execute(() => {
    const messages = [
      ...document.querySelectorAll(".message-row--agent[data-message-id]"),
    ].filter((message) => message.textContent?.includes("@Owner"));
    return Number(messages.at(-1)?.getAttribute("data-message-id"));
  });
  expect(messageId).toBeGreaterThan(0);
  return messageId;
}

async function latestHumanMessageId() {
  return browser.execute(() => {
    const messages = document.querySelectorAll(
      ".message-row--human[data-message-id]",
    );
    return Number(
      messages.item(messages.length - 1)?.getAttribute("data-message-id"),
    );
  });
}

async function waitForNewHumanMessageId(previousMessageId) {
  let messageId = 0;
  await browser.waitUntil(
    async () => {
      messageId = await latestHumanMessageId();
      return messageId > previousMessageId;
    },
    {
      timeout: 10_000,
      timeoutMsg: "Expected a new Human message to trigger the Agent",
    },
  );
  return messageId;
}

async function expectMockActivationContract(messageId) {
  const expected = {
    ackRequests: 1,
    ackResults: 1,
    sendRequests: 1,
    sendResults: 1,
  };
  await browser.waitUntil(
    () => {
      const contract = mockActivationContracts.get(messageId);
      return (
        contract !== undefined &&
        Object.entries(expected).every(
          ([key, value]) => contract[key] === value,
        )
      );
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected one ack and one send for activation ${messageId}`,
    },
  );
  expect(mockActivationContracts.get(messageId)).toEqual(expected);
}

async function requestAgentMention(expectedUnread) {
  const composer = await $("aria/Send Message");
  const message = await composer.$("aria/Message");
  await message.setValue("@HumanPing");
  const agentCandidate = await $(
    "aria/Mention HumanPingAgent, Agent, In Discussion",
  );
  await agentCandidate.waitForDisplayed();
  await expect(agentCandidate).toHaveText(expect.stringContaining("Agent"));
  await expect(agentCandidate).toHaveText(
    expect.stringContaining("In Discussion"),
  );
  await agentCandidate.click();
  await message.addValue("Reply with exactly @Owner and no other words.");
  const previousMessageId = await latestHumanMessageId();
  await composer.$("button=Send").click();
  const triggeringMessageId = await waitForNewHumanMessageId(previousMessageId);
  await waitForUnreadCount(expectedUnread);
  await expectMockActivationContract(triggeringMessageId);
  return latestAgentMentionMessageId();
}

async function clickUnreadAThenBWhileAIsPending(messageA, messageB) {
  const overlap = await browser.executeAsync(
    (expectedA, expectedB, done) => {
      const unreadSelector =
        'section[aria-label="Human mention notifications"] button.is-unread';
      const initialButtons = [...document.querySelectorAll(unreadSelector)];
      const first = initialButtons[0];
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        done(result);
      };
      const observeA = () => {
        const target = document.querySelector(
          `[data-message-id="${expectedA}"]`,
        );
        if (
          document.activeElement !== target ||
          !target?.classList.contains("human-mention-target")
        ) {
          return;
        }
        const unreadButtons = [...document.querySelectorAll(unreadSelector)];
        const second = unreadButtons.at(-1);
        const aStillUnread = unreadButtons.length === 2;
        if (!aStillUnread || !second) {
          finish({
            aStillUnread,
            focusedMessageId: target?.getAttribute("data-message-id"),
            overlap: false,
            unreadCount: unreadButtons.length,
          });
          return;
        }
        second.click();
        finish({
          aStillUnread,
          focusedMessageId: target.getAttribute("data-message-id"),
          overlap: true,
          requestedMessageId: String(expectedB),
          unreadCount: unreadButtons.length,
        });
      };
      const observer = new MutationObserver(observeA);
      const timeout = setTimeout(
        () =>
          finish({ overlap: false, reason: "A never focused while unread" }),
        5_000,
      );
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      first?.click();
      observeA();
    },
    messageA,
    messageB,
  );
  expect(overlap).toEqual({
    aStillUnread: true,
    focusedMessageId: String(messageA),
    overlap: true,
    requestedMessageId: String(messageB),
    unreadCount: 2,
  });
}

async function clickUnreadThenLeaveWhileReadIsPending(messageId) {
  const overlap = await browser.executeAsync((expectedMessageId, done) => {
    const unreadSelector =
      'section[aria-label="Human mention notifications"] button.is-unread';
    const notification = document.querySelector(unreadSelector);
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      done(result);
    };
    const leaveAfterFocus = () => {
      const target = document.querySelector(
        `[data-message-id="${expectedMessageId}"]`,
      );
      if (
        document.activeElement !== target ||
        !target?.classList.contains("human-mention-target")
      ) {
        return;
      }
      const stillUnread =
        document.querySelectorAll(unreadSelector).length === 1;
      const members = document.querySelector('button[aria-label="Members"]');
      if (!stillUnread || !(members instanceof HTMLButtonElement)) {
        finish({
          focusedMessageId: target?.getAttribute("data-message-id"),
          navigated: false,
          stillUnread,
        });
        return;
      }
      members.click();
      finish({
        focusedMessageId: target.getAttribute("data-message-id"),
        navigated: true,
        stillUnread,
      });
    };
    const observer = new MutationObserver(leaveAfterFocus);
    const timeout = setTimeout(
      () =>
        finish({
          navigated: false,
          reason: "Message never focused while unread",
        }),
      5_000,
    );
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    notification?.click();
    leaveAfterFocus();
  }, messageId);
  expect(overlap).toEqual({
    focusedMessageId: String(messageId),
    navigated: true,
    stillUnread: true,
  });
}

describe("Human mentions", () => {
  before(async () => {
    await new Promise((resolve, reject) => {
      mockModelServer.once("error", reject);
      mockModelServer.listen(0, "127.0.0.1", resolve);
    });
    const address = mockModelServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Mock model server did not bind a TCP port");
    }
    mockModelBaseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      mockModelServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await browser.setWindowSize(1440, 900);
  });

  it("renames the current Human and keeps Human delivery outside Agent state", async () => {
    await configureMockModel();
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
    const ownerCandidate = await $("aria/Mention Owner, Human, In Discussion");
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

    const initialMessageId = await requestAgentMention(1);
    const notification = await $(
      'section[aria-label="Human mention notifications"] button.is-unread',
    );
    await expect(notification).toHaveText(expect.stringContaining("Unread"));
    await notification.click();

    const notifiedMessage =
      await waitForFocusedHighlightedMessage(initialMessageId);
    await expect(notifiedMessage).toHaveText(expect.stringContaining("@Owner"));
    await waitForUnreadCount(0);

    const messageA = await requestAgentMention(1);
    const messageB = await requestAgentMention(2);
    const unreadNotifications = await $$(
      'section[aria-label="Human mention notifications"] button.is-unread',
    );
    await expect(unreadNotifications).toBeElementsArrayOfSize(2);
    await clickUnreadAThenBWhileAIsPending(messageA, messageB);
    await waitForFocusedHighlightedMessage(messageB);
    await waitForUnreadCount(0);
    await waitForFocusedHighlightedMessage(messageB);

    const messageC = await requestAgentMention(1);
    await clickUnreadThenLeaveWhileReadIsPending(messageC);
    await $("aria/Open Owner").waitForDisplayed();
    await $("aria/Discussions").click();
    const returnedComposer = await $("aria/Send Message");
    await returnedComposer.waitForDisplayed();
    await returnedComposer.$("aria/Message").click();
    await waitForUnreadCount(0);
    await waitForMessageHighlightToClear(messageC);
    await expect(returnedComposer.$("aria/Message")).toBeFocused();
    const staleTarget = await $(`[data-message-id="${messageC}"]`);
    await expect(staleTarget).not.toHaveElementClass("human-mention-target");
  }).timeout(300_000);
});
