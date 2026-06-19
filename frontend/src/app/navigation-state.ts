import type { ViewId } from "@/components/flowent/types";

const viewIds = new Set<ViewId>([
  "workspace",
  "workflows",
  "providers",
  "channels",
  "mcp",
  "permissions",
  "skills",
  "settings",
]);

export type NavigationState = {
  view: ViewId;
  workflowId: string;
};

const defaultNavigationState = {
  view: "workspace",
  workflowId: "",
} satisfies NavigationState;

const normalizeView = (view: string | null): ViewId =>
  view && viewIds.has(view as ViewId)
    ? (view as ViewId)
    : defaultNavigationState.view;

const decodePathSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
};

const readPathNavigationState = (pathname: string): NavigationState | null => {
  const pathSegments = pathname
    .split("/")
    .filter(Boolean)
    .map(decodePathSegment);
  const [viewSegment, workflowId = ""] = pathSegments;

  if (!viewSegment) {
    return defaultNavigationState;
  }

  if (viewSegment === "workflows") {
    return {
      view: "workflows",
      workflowId,
    };
  }

  if (viewIds.has(viewSegment as ViewId)) {
    return {
      view: viewSegment as ViewId,
      workflowId: "",
    };
  }

  return null;
};

const readLegacySearchNavigationState = (search: string): NavigationState => {
  const params = new URLSearchParams(search);
  const view = normalizeView(params.get("view"));
  const workflowId = view === "workflows" ? (params.get("workflow") ?? "") : "";
  return { view, workflowId };
};

export const readNavigationState = (
  location: Pick<Location, "pathname" | "search"> = window.location,
): NavigationState => {
  const pathNavigationState = readPathNavigationState(location.pathname);
  const hasLegacyView = new URLSearchParams(location.search).has("view");

  if (
    pathNavigationState &&
    (!hasLegacyView || pathNavigationState.view !== defaultNavigationState.view)
  ) {
    return pathNavigationState;
  }

  return readLegacySearchNavigationState(location.search);
};

export const navigationStateToPath = ({
  view,
  workflowId,
}: NavigationState): string => {
  if (view === "workflows") {
    return workflowId
      ? `/workflows/${encodeURIComponent(workflowId)}`
      : "/workflows";
  }

  if (view !== defaultNavigationState.view) {
    return `/${view}`;
  }

  return "/";
};

export const writeNavigationState = (
  state: NavigationState,
  options: { replace?: boolean } = {},
) => {
  const nextUrl = `${navigationStateToPath(state)}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextUrl === currentUrl) {
    return;
  }

  if (options.replace) {
    window.history.replaceState(null, "", nextUrl);
    return;
  }

  window.history.pushState(null, "", nextUrl);
};
