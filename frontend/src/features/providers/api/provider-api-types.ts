import type { Provider } from "@/features/providers/model/provider-types";

export type ApiProvider = {
  base_url: string;
  has_api_key: boolean;
  id: string;
  models: string[];
  name: string;
  type: Provider["type"];
};

export type ApiProviderSaveRequest = Omit<ApiProvider, "has_api_key"> & {
  api_key?: string;
};
