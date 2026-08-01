import { describe, expect, it } from "vitest";

import { appInfoRequest, readAppInfoReply } from "@/lib/app-info";

describe("app info protocol", () => {
  it("creates an app information request", () => {
    expect(appInfoRequest("ui-1")).toEqual({
      id: "ui-1",
      method: "app/info",
    });
  });

  it("reads the matching response", () => {
    expect(
      readAppInfoReply(
        {
          id: "ui-1",
          result: { name: "Flowent", version: "0.0.0" },
        },
        "ui-1",
      ),
    ).toEqual({
      status: "ready",
      info: { name: "Flowent", version: "0.0.0" },
    });
  });
});
