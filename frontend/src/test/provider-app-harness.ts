import { vi } from "vitest";

import { emptyTelegramBotState, type TestProvider } from "@/test/app-fixtures";

type ProviderSaveRequest = Omit<TestProvider, "has_api_key"> & {
  api_key?: string;
};

type ProviderAppHarnessOptions = {
  initialState?: Record<string, unknown>;
  modelResults?: string[];
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

export const mockProviderAppRequests = ({
  initialState = {},
  modelResults = ["gpt-5.1"],
}: ProviderAppHarnessOptions = {}) => {
  const state: Record<string, unknown> = {
    mcp_servers: [],
    messages: [],
    providers: [],
    settings: {
      selected_model: "",
      selected_provider_id: "",
    },
    skills: [],
    telegram_bot: emptyTelegramBotState(),
    ...initialState,
  };

  const fetchSpy = vi
    .spyOn(window, "fetch")
    .mockImplementation(async (input, init) => {
      const url = requestUrl(input);

      if (url === "/api/state") {
        return jsonResponse(state);
      }

      if (url === "/api/about") {
        return jsonResponse({ version: "test" });
      }

      if (url === "/api/providers/models" && init?.method === "POST") {
        return jsonResponse({ models: modelResults });
      }

      if (url === "/api/providers" && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as ProviderSaveRequest;
        const currentProviders = state.providers as TestProvider[];
        const currentProvider = currentProviders.find(
          (provider) => provider.id === request.id,
        );
        const { api_key: apiKey, ...provider } = request;
        const persistedProvider: TestProvider = {
          ...provider,
          has_api_key: Boolean(apiKey) || currentProvider?.has_api_key || false,
        };
        state.providers = [
          ...currentProviders.filter(
            (existingProvider) => existingProvider.id !== persistedProvider.id,
          ),
          persistedProvider,
        ];
        return jsonResponse(persistedProvider);
      }

      if (url.startsWith("/api/providers/") && init?.method === "DELETE") {
        const providerId = url.replace("/api/providers/", "");
        state.providers = (state.providers as TestProvider[]).filter(
          (provider) => provider.id !== providerId,
        );
        return jsonResponse({ ok: true });
      }

      if (url === "/api/settings" && init?.method === "PUT") {
        const settings = JSON.parse(String(init.body)) as Record<
          string,
          unknown
        >;
        state.settings = settings;
        return jsonResponse(settings);
      }

      return jsonResponse({ detail: "Not found" }, 404);
    });

  return {
    fetchSpy,
    getState: () => state,
  };
};
