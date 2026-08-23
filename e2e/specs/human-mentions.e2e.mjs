import { createServer } from "node:http";
import { $, browser, expect } from "@wdio/globals";
import { after, before, beforeEach, describe, it } from "mocha";

const mockModelServer = createServer((request, response) => {
  let rawBody = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    rawBody += chunk;
  });
  request.on("end", () => {
    const payload = JSON.parse(rawBody);
    const hasToolResult = payload.messages.some(
      (message) => message.role === "tool",
    );
    const finishReason = hasToolResult ? "stop" : "tool_calls";
    const delta = hasToolResult
      ? { role: "assistant", content: "Done" }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call-human-mention",
              type: "function",
              function: {
                name: "discussion",
                arguments: JSON.stringify({
                  action: "send",
                  discussion_id: 1,
                  body: "@Owner",
                }),
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
          model: "flowent-e2e-model",
          choices: [{ index: 0, delta, finish_reason: null }],
        })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-human-mention",
          object: "chat.completion.chunk",
          created: 1,
          model: "flowent-e2e-model",
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
        model: "flowent-e2e-model",
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
  await apiKey.setValue("flowent-e2e-key");
  await model.setValue("flowent-e2e-model");
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
