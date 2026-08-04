import { invoke } from "@tauri-apps/api/core";

export async function setProviderSecret(
  providerId: string,
  apiKey: string,
): Promise<void> {
  await invoke<void>("set_provider_secret", {
    providerId,
    value: apiKey,
  });
}

export async function deleteProviderSecret(providerId: string): Promise<void> {
  await invoke<void>("delete_provider_secret", {
    providerId,
  });
}
