import type { PageId } from "@/context/AgentContext";

export const DEFAULT_PAGE_ID: PageId = "assistant";
export const APP_ROUTE_CHANGE_EVENT = "flowent-route-change";

export type SettingsSectionId =
  | "model"
  | "assistant"
  | "leader"
  | "access"
  | "path";

export type RoleRouteMode = "view" | "edit" | "create";

export interface AppRouteState {
  page: PageId;
  providerId: string | null;
  providerMode: "list" | "create" | "detail";
  roleName: string | null;
  roleMode: RoleRouteMode | null;
  settingsSection: SettingsSectionId;
  workspaceTabId: string | null;
}

const PAGE_IDS = new Set<PageId>([
  "assistant",
  "workspace",
  "providers",
  "roles",
  "prompts",
  "tools",
  "channels",
  "settings",
]);

const SETTINGS_SECTIONS = new Set<SettingsSectionId>([
  "model",
  "assistant",
  "leader",
  "access",
  "path",
]);

const defaultRouteState: AppRouteState = {
  page: DEFAULT_PAGE_ID,
  providerId: null,
  providerMode: "list",
  roleName: null,
  roleMode: null,
  settingsSection: "access",
  workspaceTabId: null,
};

function decodeSegment(segment: string | undefined) {
  if (!segment) {
    return null;
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function encodeSegment(segment: string) {
  return encodeURIComponent(segment);
}

function splitPathname(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

export function isPageId(value: string): value is PageId {
  return PAGE_IDS.has(value as PageId);
}

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.has(value as SettingsSectionId);
}

export function parseAppRouteFromLocation(
  location: Pick<Location, "pathname">,
): AppRouteState {
  const [firstSegment, secondSegment, thirdSegment] = splitPathname(
    location.pathname,
  );

  if (!firstSegment || !isPageId(firstSegment)) {
    return defaultRouteState;
  }

  if (firstSegment === "providers") {
    if (secondSegment === "new") {
      return {
        ...defaultRouteState,
        page: "providers",
        providerMode: "create",
      };
    }

    const providerId = decodeSegment(secondSegment);
    return {
      ...defaultRouteState,
      page: "providers",
      providerId,
      providerMode: providerId ? "detail" : "list",
    };
  }

  if (firstSegment === "roles") {
    if (secondSegment === "new") {
      return {
        ...defaultRouteState,
        page: "roles",
        roleMode: "create",
      };
    }

    const roleName = decodeSegment(secondSegment);
    return {
      ...defaultRouteState,
      page: "roles",
      roleName,
      roleMode: roleName ? (thirdSegment === "edit" ? "edit" : "view") : null,
    };
  }

  if (firstSegment === "settings") {
    const settingsSection =
      secondSegment && isSettingsSectionId(secondSegment)
        ? secondSegment
        : defaultRouteState.settingsSection;
    return {
      ...defaultRouteState,
      page: "settings",
      settingsSection,
    };
  }

  if (firstSegment === "workspace") {
    return {
      ...defaultRouteState,
      page: "workspace",
      workspaceTabId: decodeSegment(secondSegment),
    };
  }

  return {
    ...defaultRouteState,
    page: firstSegment,
  };
}

export function getRoutePathForPage(page: PageId) {
  return `/${page}`;
}

export function getRoutePathForProvider(providerId: string | null) {
  return providerId ? `/providers/${encodeSegment(providerId)}` : "/providers";
}

export function getRoutePathForProviderCreate() {
  return "/providers/new";
}

export function getRoutePathForRole(
  roleName: string | null,
  mode: Exclude<RoleRouteMode, "create"> = "view",
) {
  if (!roleName) {
    return "/roles";
  }

  const base = `/roles/${encodeSegment(roleName)}`;
  return mode === "edit" ? `${base}/edit` : base;
}

export function getRoutePathForRoleCreate() {
  return "/roles/new";
}

export function getRoutePathForSettings(section: SettingsSectionId) {
  return `/settings/${section}`;
}

export function getRoutePathForWorkspace(tabId: string | null) {
  return tabId ? `/workspace/${encodeSegment(tabId)}` : "/workspace";
}

export function replaceBrowserPath(path: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (window.location.pathname === path) {
    return;
  }

  window.history.replaceState(null, "", path);
  window.dispatchEvent(new Event(APP_ROUTE_CHANGE_EVENT));
}

export function pushBrowserPath(path: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (window.location.pathname === path) {
    return;
  }

  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(APP_ROUTE_CHANGE_EVENT));
}
