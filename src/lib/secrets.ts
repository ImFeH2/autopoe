import { invoke } from "@tauri-apps/api/core";

function providerKey(providerId: string) {
  return `provider/${providerId}`;
}

export async function setProviderSecret(
  providerId: string,
  apiKey: string,
): Promise<void> {
  await invoke<void>("set_secret", {
    key: providerKey(providerId),
    value: apiKey,
  });
}

export async function getProviderSecret(
  providerId: string,
): Promise<string | null> {
  return invoke<string | null>("get_secret", {
    key: providerKey(providerId),
  });
}

export async function deleteProviderSecret(providerId: string): Promise<void> {
  await invoke<void>("delete_secret", {
    key: providerKey(providerId),
  });
}
