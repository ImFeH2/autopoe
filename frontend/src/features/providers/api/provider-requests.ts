import type { ApiProvider } from "@/features/providers/api/provider-api-types";
import {
  providerFromApi,
  providerToApi,
} from "@/features/providers/api/provider-mappers";
import type { Provider } from "@/features/providers/model/provider-types";

const providerModelFetchFailureMessages = {
  access_denied: {
    description: "Check the key and account access.",
    message: "Access denied.",
  },
  connection_failed: {
    description: "Check the address and try again.",
    message: "Connection failed.",
  },
  provider_unavailable: {
    description: "The service is currently unreachable.",
    message: "Provider unavailable.",
  },
  rate_limited: {
    description: "Please wait a moment and try again.",
    message: "Too many requests.",
  },
  request_failed: {
    description: "Check the connection settings and try again.",
    message: "Request failed.",
  },
} as const;

type ProviderModelFetchFailure = keyof typeof providerModelFetchFailureMessages;

export type ProviderNotification = {
  description?: string;
  message: string;
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
  typeof value === "string" && value in providerModelFetchFailureMessages;

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
        providerModelFetchFailureMessages[failure],
      );
    }

    const result = (await response.json()) as { models?: string[] };
    return result.models ?? [];
  } catch (error) {
    if (error instanceof ProviderModelFetchError) {
      throw error;
    }
    throw new ProviderModelFetchError(
      providerModelFetchFailureMessages.connection_failed,
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
