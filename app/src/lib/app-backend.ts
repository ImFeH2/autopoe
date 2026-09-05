import { invoke } from "@tauri-apps/api/core";

export type BackendTarget =
  | { kind: "native" }
  | { kind: "wsl"; distribution: string };

export type BackendStatus = {
  platform: string;
  active: BackendTarget | null;
  configured: BackendTarget | null;
  restart_required: boolean;
  error: string | null;
  distributions: string[];
  probe_error: string | null;
};

export class AppBackend {
  status() {
    return invoke<BackendStatus>("backend_status");
  }

  save(target: BackendTarget) {
    return invoke<BackendStatus>("set_backend", { target });
  }
}

const insideTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const appBackend: AppBackend =
  import.meta.env.DEV && !insideTauri
    ? (await import("./mock")).createAppBackendMock(AppBackend)
    : new AppBackend();
