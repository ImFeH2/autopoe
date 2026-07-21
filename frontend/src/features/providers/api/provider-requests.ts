import type { ApiProvider } from "@/features/providers/api/provider-api-types";
import {
  providerFromApi,
  providerToApi,
} from "@/features/providers/api/provider-mappers";
import type { Provider } from "@/features/providers/model/provider-types";
import i18n from "@/i18n/i18n";

const providerModelFetchFailureKeys = {
  access_denied: {
    description: "setup.providers.errors.accessDenied.description",
    message: "setup.providers.errors.accessDenied.message",
  },
  connection_failed: {
    description: "setup.providers.errors.connectionFailed.description",
    message: "setup.providers.errors.connectionFailed.message",
  },
  provider_unavailable: {
    description: "setup.providers.errors.unavailable.description",
    message: "setup.providers.errors.unavailable.message",
  },
  rate_limited: {
    description: "setup.providers.errors.rateLimited.description",
    message: "setup.providers.errors.rateLimited.message",
  },
  request_failed: {
    description: "setup.providers.errors.requestFailed.description",
    message: "setup.providers.errors.requestFailed.message",
  },
} as const;

type ProviderModelFetchFailure = keyof typeof providerModelFetchFailureKeys;

export type ProviderNotification = {
  description?: string;
  message: string;
};

const providerModelFetchFailureNotification = (
  failure: ProviderModelFetchFailure,
): ProviderNotification => {
  const keys = providerModelFetchFailureKeys[failure];
  return {
    description: i18n.t(keys.description),
    message: i18n.t(keys.message),
  };
};

export class ProviderModelFetchError extends Error {
  notification: ProviderNotification;

  constructor(notification: ProviderNotification) {
    super(notification.message);
    this.name = "ProviderModelFetchError";
    this.notification = notification;
  }
}

const isProviderModelFetchFailure = (
  value: unknown,
): value is ProviderModelFetchFailure =>
  typeof value === "string" && value in providerModelFetchFailureKeys;

const providerModelFetchFailureFromResponse = async (
  response: Response,
): Promise<ProviderModelFetchFailure> => {
  try {
    const result = (await response.json()) as { detail?: { code?: unknown } };
    const code = result.detail?.code;
    if (isProviderModelFetchFailure(code)) {
      return code;
    }
  } catch {
    return "request_failed";
  }

  return "request_failed";
};

export const fetchProviderModelsRequest = async (
  provider: Pick<Provider, "apiKey" | "baseUrl" | "id" | "type">,
) => {
  try {
    const response = await fetch("/api/providers/models", {
      body: JSON.stringify({
        base_url: provider.baseUrl,
        provider: provider.type,
        provider_id: provider.id,
        secret_reference: provider.apiKey,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      const failure = await providerModelFetchFailureFromResponse(response);
      throw new ProviderModelFetchError(
        providerModelFetchFailureNotification(failure),
      );
    }

    const result = (await response.json()) as { models?: string[] };
    return result.models ?? [];
  } catch (error) {
    if (error instanceof ProviderModelFetchError) {
      throw error;
    }
    throw new ProviderModelFetchError(
      providerModelFetchFailureNotification("connection_failed"),
    );
  }
};

export const saveProviderRequest = async (provider: Provider) => {
  const response = await fetch("/api/providers", {
    body: JSON.stringify(providerToApi(provider)),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    return null;
  }
  return providerFromApi((await response.json()) as ApiProvider);
};

export const removeProviderRequest = async (providerId: string) => {
  const response = await fetch(`/api/providers/${providerId}`, {
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  });
  return response.ok;
};
