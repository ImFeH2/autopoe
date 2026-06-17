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

export const readNavigationState = (
  location: Pick<Location, "search"> = window.location,
): NavigationState => {
  const params = new URLSearchParams(location.search);
  const view = normalizeView(params.get("view"));
  const workflowId = view === "workflows" ? (params.get("workflow") ?? "") : "";
  return { view, workflowId };
};

export const navigationStateToSearch = ({
  view,
  workflowId,
}: NavigationState): string => {
  const params = new URLSearchParams();

  if (view !== defaultNavigationState.view) {
    params.set("view", view);
  }

  if (view === "workflows" && workflowId) {
    params.set("workflow", workflowId);
  }

  const search = params.toString();
  return search ? `?${search}` : "";
};

export const writeNavigationState = (
  state: NavigationState,
  options: { replace?: boolean } = {},
) => {
  const nextUrl = `${window.location.pathname}${navigationStateToSearch(state)}${window.location.hash}`;
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
