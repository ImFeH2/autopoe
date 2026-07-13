import type {
  ApiProvider,
  ApiProviderSaveRequest,
} from "@/features/providers/api/provider-api-types";
import type { Provider } from "@/features/providers/model/provider-types";

export const providerFromApi = (provider: ApiProvider): Provider => ({
  apiKey: "",
  baseUrl: provider.base_url,
  hasAccessKey: provider.has_api_key ?? false,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
});

export const providerToApi = (provider: Provider): ApiProviderSaveRequest => ({
  base_url: provider.baseUrl,
  id: provider.id,
  models: provider.models,
  name: provider.name,
  type: provider.type,
  ...(provider.apiKey ? { api_key: provider.apiKey } : {}),
});
