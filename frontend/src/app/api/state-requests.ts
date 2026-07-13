import type { ApiAbout, ApiState } from "@/app/api/types";

export const fetchAppState = async () => {
  const response = await fetch("/api/state");
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as ApiState;
};

export const fetchAbout = async () => {
  const response = await fetch("/api/about");
  if (!response.ok) {
    return {};
  }
  return (await response.json()) as ApiAbout;
};
