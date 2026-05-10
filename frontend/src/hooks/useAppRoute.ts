import { useSyncExternalStore } from "react";
import {
  APP_ROUTE_CHANGE_EVENT,
  parseAppRouteFromLocation,
} from "@/lib/urlNavigation";

function getSnapshot() {
  return window.location.pathname;
}

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(APP_ROUTE_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(APP_ROUTE_CHANGE_EVENT, listener);
  };
}

export function useAppRoute() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return parseAppRouteFromLocation(window.location);
}
