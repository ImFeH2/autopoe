import { vi } from "vitest";

import {
  selectedProviderState,
  type TestWritablePath,
} from "@/test/app-fixtures";

type PermissionsAppHarnessOptions = {
  addFailure?: boolean;
  initialPaths?: TestWritablePath[];
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

export const mockPermissionsAppRequests = ({
  addFailure = false,
  initialPaths = [],
}: PermissionsAppHarnessOptions = {}) => {
  let writablePaths = [...initialPaths];

  return vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);

    if (url === "/api/state") {
      return jsonResponse({
        ...selectedProviderState(),
        writable_paths: writablePaths,
      });
    }

    if (url === "/api/about") {
      return jsonResponse({ version: "test" });
    }

    if (
      url === "/api/permissions/writable-paths" &&
      init?.method === "DELETE"
    ) {
      const request = JSON.parse(String(init.body)) as { path: string };
      writablePaths = writablePaths.filter(
        (writablePath) => writablePath.path !== request.path,
      );
      return jsonResponse({ writable_paths: writablePaths });
    }

    if (url === "/api/permissions/writable-paths" && init?.method === "POST") {
      if (addFailure) {
        return new Response(null, { status: 500 });
      }
      const request = JSON.parse(String(init.body)) as { path: string };
      const writablePath = {
        created_at: 1710000010,
        path: request.path,
      };
      writablePaths = [...writablePaths, writablePath];
      return jsonResponse(writablePath);
    }

    return jsonResponse({ detail: "Not found" }, 404);
  });
};
