import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
}

export function getAppInfo() {
  return invoke<AppInfo>("get_app_info");
}
