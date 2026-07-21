import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import i18n from "@/i18n/i18n";
import {
  languageFromBrowser,
  languageStorageKey,
  resolveInitialLanguage,
} from "@/i18n/languages";
import {
  savedWorkflow,
  selectedProviderState,
  workflowUuid,
} from "@/test/app-fixtures";
import { mockAppShellRequests } from "@/test/app-shell-harness";
import { mockMcpAppRequests } from "@/test/mcp-app-harness";
import { mockSettingsAppRequests } from "@/test/settings-app-harness";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const deferredResponse = () => {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe("Interface language", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
    document.documentElement.lang = "en";
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("matches Chinese browser preferences on first visit", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue([
      "zh-CN",
      "en-US",
    ]);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");

    expect(languageFromBrowser()).toBe("zh-CN");
    expect(resolveInitialLanguage()).toBe("zh-CN");
  });

  it("uses the first supported browser language", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue([
      "en-US",
      "zh-CN",
    ]);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");

    expect(languageFromBrowser()).toBe("en");
    expect(resolveInitialLanguage()).toBe("en");
  });

  it("keeps an explicit language preference ahead of the browser language", () => {
    window.localStorage.setItem(languageStorageKey, "en");
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");

    expect(resolveInitialLanguage()).toBe("en");
  });

  it("switches the full interface immediately and remembers the choice", async () => {
    const user = userEvent.setup();
    const fetchMock = mockSettingsAppRequests();
    await i18n.changeLanguage("en");
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("combobox", { name: "Language" }));
    await user.click(screen.getByRole("option", { name: "简体中文" }));

    await waitFor(() => {
      expect(window.localStorage.getItem(languageStorageKey)).toBe("zh-CN");
    });
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(screen.getByRole("tab", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "工作区" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent(
      "简体中文",
    );
    expect(
      screen.getByRole("heading", { name: "模型设置" }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => input === "/api/settings" && init?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("updates known Workspace errors when the language changes", async () => {
    const user = userEvent.setup();
    mockAppShellRequests({
      ...selectedProviderState(),
      messages: [
        {
          author: "assistant",
          content: "",
          groups: [
            {
              id: "message-assistant-errors",
              items: [
                {
                  detail: "",
                  id: "message-assistant-error-1",
                  message: "Context could not be optimized.",
                  title: "Request failed",
                  type: "error",
                },
              ],
            },
          ],
          id: "message-assistant",
          status: "failed",
        },
      ],
    });
    render(<App />);

    expect(
      await screen.findByText("Context could not be optimized."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(screen.getByRole("option", { name: "简体中文" }));
    await user.click(screen.getByRole("tab", { name: "工作区" }));

    expect(await screen.findByText("上下文未能优化。")).toBeInTheDocument();
    expect(
      screen.queryByText("Context could not be optimized."),
    ).not.toBeInTheDocument();
  });

  it("does not keep a localized client fallback as error detail", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("zh-CN");
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return jsonResponse(selectedProviderState());
      }
      if (input === "/api/about") {
        return jsonResponse({ version: "test" });
      }
      if (input === "/api/workspace/respond" && init?.method === "POST") {
        return new Response(null, { status: 500 });
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });
    render(<App />);

    const composer = await screen.findByRole("textbox", {
      name: "给 Flowent 发消息",
    });
    await user.type(composer, "测试发送失败");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请求失败");

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Request failed");
    expect(alert).not.toHaveTextContent("消息未能发送。");
  });

  it("uses the active language when an async notification completes", async () => {
    const user = userEvent.setup();
    const modelsResponse = deferredResponse();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (input === "/api/state") {
        return jsonResponse(selectedProviderState());
      }
      if (input === "/api/about") {
        return jsonResponse({ version: "test" });
      }
      if (input === "/api/providers/models" && init?.method === "POST") {
        return modelsResponse.promise;
      }
      return jsonResponse({ detail: "Not found" }, 404);
    });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Providers" }));
    await user.click(await screen.findByRole("button", { name: "Fetch" }));
    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });
    modelsResponse.resolve(jsonResponse({ models: [] }));

    const notification = await screen.findByRole("alert");
    expect(notification).toHaveTextContent("未找到模型。");
    expect(notification).toHaveTextContent("此模型服务没有可用模型。");
  });

  it("uses a localized default name for an unnamed MCP service", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("zh-CN");
    mockMcpAppRequests();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "MCP" }));
    await user.click(await screen.findByRole("button", { name: "保存" }));

    const saveCall = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) =>
          input === "/api/mcp/servers" && init?.method === "PUT",
      );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      name: "服务",
    });
  });

  it("keeps canonical workflow node data in the Chinese interface", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(workflowUuid);
    await i18n.changeLanguage("zh-CN");
    mockAppShellRequests({ ...selectedProviderState(), workflows: [] });
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "工作流" }));
    await user.click(await screen.findByRole("button", { name: "添加节点" }));
    await user.click(await screen.findByRole("menuitem", { name: /^输入$/ }));

    await waitFor(
      () => {
        expect(window.fetch).toHaveBeenCalledWith(
          "/api/workflows",
          expect.objectContaining({ method: "PUT" }),
        );
      },
      { timeout: 2000 },
    );
    const saveCall = vi
      .mocked(window.fetch)
      .mock.calls.find(
        ([input, init]) => input === "/api/workflows" && init?.method === "PUT",
      );
    const body = JSON.parse(String(saveCall?.[1]?.body));
    expect(Object.values(body.workflow.presentation.nodes)[0]).toMatchObject({
      name: "Input",
    });
    expect(body.workflow.spec.nodes[0]).toMatchObject({
      config: { default_value: "", input_type: "text" },
      kind: "input",
    });
  });

  it("identifies the workflow for each localized options button", async () => {
    await i18n.changeLanguage("zh-CN");
    mockAppShellRequests({
      ...selectedProviderState(),
      workflows: [savedWorkflow()],
    });
    render(<App />);

    expect(
      await screen.findByRole("button", {
        name: "“Launch Workflow”的更多操作",
      }),
    ).toBeInTheDocument();
  });
});
