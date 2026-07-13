import { vi } from "vitest";

import { selectedProviderState } from "@/test/app-fixtures";

type SettingsAppHarnessOptions = {
  initialSettings?: Record<string, unknown>;
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

export const mockSettingsAppRequests = ({
  initialSettings = selectedProviderState().settings,
}: SettingsAppHarnessOptions = {}) => {
  let settings = initialSettings;

  return vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);

    if (url === "/api/state") {
      return jsonResponse({ ...selectedProviderState(), settings });
    }

    if (url === "/api/about") {
      return jsonResponse({ version: "test" });
    }

    if (url === "/api/settings" && init?.method === "PUT") {
      settings = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse(settings);
    }

    return jsonResponse({ detail: "Not found" }, 404);
  });
};
