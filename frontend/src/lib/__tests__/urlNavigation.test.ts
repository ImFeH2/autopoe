import { describe, expect, it } from "vitest";
import {
  getRoutePathForProvider,
  getRoutePathForRole,
  getRoutePathForSettings,
  getRoutePathForWorkspace,
  parseAppRouteFromLocation,
} from "@/lib/urlNavigation";

function locationFor(pathname: string): Pick<Location, "pathname"> {
  return { pathname };
}

describe("urlNavigation", () => {
  it("defaults unknown and root paths to Assistant", () => {
    expect(parseAppRouteFromLocation(locationFor("/")).page).toBe("assistant");
    expect(parseAppRouteFromLocation(locationFor("/unknown")).page).toBe(
      "assistant",
    );
  });

  it("parses provider list, creation, and detail routes", () => {
    expect(parseAppRouteFromLocation(locationFor("/providers"))).toMatchObject({
      page: "providers",
      providerId: null,
      providerMode: "list",
    });
    expect(
      parseAppRouteFromLocation(locationFor("/providers/new")),
    ).toMatchObject({
      page: "providers",
      providerMode: "create",
    });
    expect(
      parseAppRouteFromLocation(locationFor("/providers/provider%201")),
    ).toMatchObject({
      page: "providers",
      providerId: "provider 1",
      providerMode: "detail",
    });
  });

  it("parses role list, creation, view, and edit routes", () => {
    expect(parseAppRouteFromLocation(locationFor("/roles"))).toMatchObject({
      page: "roles",
      roleName: null,
      roleMode: null,
    });
    expect(parseAppRouteFromLocation(locationFor("/roles/new"))).toMatchObject({
      page: "roles",
      roleMode: "create",
    });
    expect(
      parseAppRouteFromLocation(locationFor("/roles/Code%20Reviewer")),
    ).toMatchObject({
      page: "roles",
      roleName: "Code Reviewer",
      roleMode: "view",
    });
    expect(
      parseAppRouteFromLocation(locationFor("/roles/Code%20Reviewer/edit")),
    ).toMatchObject({
      page: "roles",
      roleName: "Code Reviewer",
      roleMode: "edit",
    });
  });

  it("parses settings and workspace subroutes", () => {
    expect(
      parseAppRouteFromLocation(locationFor("/settings/path")),
    ).toMatchObject({
      page: "settings",
      settingsSection: "path",
    });
    expect(
      parseAppRouteFromLocation(locationFor("/settings/not-real")),
    ).toMatchObject({
      page: "settings",
      settingsSection: "model",
    });
    expect(
      parseAppRouteFromLocation(locationFor("/workspace/workflow%201")),
    ).toMatchObject({
      page: "workspace",
      workspaceTabId: "workflow 1",
    });
  });

  it("builds encoded route paths", () => {
    expect(getRoutePathForProvider("provider 1")).toBe(
      "/providers/provider%201",
    );
    expect(getRoutePathForRole("Code Reviewer", "edit")).toBe(
      "/roles/Code%20Reviewer/edit",
    );
    expect(getRoutePathForSettings("assistant")).toBe("/settings/assistant");
    expect(getRoutePathForWorkspace("workflow 1")).toBe(
      "/workspace/workflow%201",
    );
  });
});
