import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerOptions } from "@/components/flowent/provider-options";
import {
  dashedPanelClassName,
  dataRowClassName,
  dataRowLabelClassName,
  emptyStateClassName,
  fieldGroupClassName,
  fieldInputClassName,
  fieldLabelClassName,
  fieldTriggerClassName,
  formActionsClassName,
  mutedTextClassName,
  navigationLabelClassName,
  stableScrollbarClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import type { Provider } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function ProvidersView({
  activeProvider,
  fetchError,
  isFetchingModels,
  isCreatingProvider,
  onFetchModels,
  onNewProvider,
  onProviderSelect,
  onSaveProvider,
  onUpdateProvider,
  providers,
}: {
  activeProvider: Provider;
  fetchError: string;
  isFetchingModels: boolean;
  isCreatingProvider: boolean;
  onFetchModels: () => void;
  onNewProvider: () => void;
  onProviderSelect: (provider: Provider) => void;
  onSaveProvider: () => void;
  onUpdateProvider: (updates: Partial<Provider>) => void;
  providers: Provider[];
}) {
  return (
    <section className="grid h-full min-h-0 bg-black" aria-label="Providers">
      <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
        <ProviderSidebar
          activeProvider={activeProvider}
          isCreatingProvider={isCreatingProvider}
          onNewProvider={onNewProvider}
          onProviderSelect={onProviderSelect}
          providers={providers}
        />
        <ProviderDetails
          activeProvider={activeProvider}
          fetchError={fetchError}
          isFetchingModels={isFetchingModels}
          onFetchModels={onFetchModels}
          onSaveProvider={onSaveProvider}
          onUpdateProvider={onUpdateProvider}
        />
      </div>
    </section>
  );
}

function ProviderSidebar({
  activeProvider,
  isCreatingProvider,
  onNewProvider,
  onProviderSelect,
  providers,
}: {
  activeProvider: Provider;
  isCreatingProvider: boolean;
  onNewProvider: () => void;
  onProviderSelect: (provider: Provider) => void;
  providers: Provider[];
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-auto border-r border-white/10 bg-black p-4 max-[900px]:max-h-64 max-[900px]:border-r-0 max-[900px]:border-b",
        stableScrollbarClassName,
      )}
      aria-label="Provider list"
    >
      <Button
        aria-pressed={isCreatingProvider}
        className="h-8 w-full border-dashed border-white/20 bg-input/30 text-base text-white shadow-none hover:bg-input/50"
        onClick={onNewProvider}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden="true" />
        New
      </Button>
      <div className="mt-4 -mx-2.5 grid gap-0">
        {providers.length === 0 ? (
          <p className={emptyStateClassName}>No providers</p>
        ) : null}
        {providers.map((provider) => {
          const isActive =
            !isCreatingProvider && activeProvider.id === provider.id;

          return (
            <Button
              aria-label={provider.name}
              aria-pressed={isActive}
              className={cn(
                "grid h-9 w-full cursor-pointer justify-start rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-left text-white shadow-none transition-colors duration-100 hover:bg-[#171717]",
                navigationLabelClassName,
                isActive && "bg-[#2f2f2f]",
              )}
              key={provider.id}
              onClick={() => onProviderSelect(provider)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {provider.name}
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );
}

function ProviderDetails({
  activeProvider,
  fetchError,
  isFetchingModels,
  onFetchModels,
  onSaveProvider,
  onUpdateProvider,
}: {
  activeProvider: Provider;
  fetchError: string;
  isFetchingModels: boolean;
  onFetchModels: () => void;
  onSaveProvider: () => void;
  onUpdateProvider: (updates: Partial<Provider>) => void;
}) {
  return (
    <form
      className={cn(
        "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
      aria-label="Provider details"
      onSubmit={(event) => {
        event.preventDefault();
        onSaveProvider();
      }}
    >
      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">Details</h3>
        <div className={dashedPanelClassName}>
          <ProviderFields
            activeProvider={activeProvider}
            onUpdateProvider={onUpdateProvider}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">Models</h3>
        <ProviderModels
          fetchError={fetchError}
          models={activeProvider.models}
        />
      </section>

      <div className={cn(formActionsClassName, "mt-0")}>
        <Button
          className={subtleButtonClassName}
          disabled={isFetchingModels}
          onClick={onFetchModels}
          type="button"
          variant="outline"
        >
          {isFetchingModels ? "Fetching" : "Fetch"}
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

function ProviderFields({
  activeProvider,
  onUpdateProvider,
}: {
  activeProvider: Provider;
  onUpdateProvider: (updates: Partial<Provider>) => void;
}) {
  return (
    <>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="provider-name"
        >
          Provider name
        </Label>
        <Input
          className={fieldInputClassName}
          id="provider-name"
          onChange={(event) => onUpdateProvider({ name: event.target.value })}
          value={activeProvider.name}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="provider-type"
        >
          Provider type
        </Label>
        <Select
          value={activeProvider.type}
          onValueChange={(value) =>
            onUpdateProvider({
              models: [],
              type: value as Provider["type"],
            })
          }
        >
          <SelectTrigger
            className={fieldTriggerClassName}
            id="provider-type"
            aria-label="Provider type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="provider-base-url"
        >
          Base URL
        </Label>
        <Input
          className={fieldInputClassName}
          id="provider-base-url"
          onChange={(event) =>
            onUpdateProvider({ baseUrl: event.target.value })
          }
          value={activeProvider.baseUrl}
        />
      </div>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="provider-api-key"
        >
          API key
        </Label>
        <Input
          className={fieldInputClassName}
          id="provider-api-key"
          onChange={(event) => onUpdateProvider({ apiKey: event.target.value })}
          type="password"
          value={activeProvider.apiKey}
        />
      </div>
    </>
  );
}

function ProviderModels({
  fetchError,
  models,
}: {
  fetchError: string;
  models: string[];
}) {
  return (
    <div className={fieldGroupClassName}>
      {models.length === 0 ? (
        <p className={emptyStateClassName}>No models</p>
      ) : (
        <div className={dashedPanelClassName}>
          {models.map((model) => (
            <div
              className={cn(
                "min-h-10 border-b border-white/10 px-3 py-2 text-base leading-5 text-white last:border-b-0",
                mutedTextClassName,
              )}
              key={model}
            >
              {model}
            </div>
          ))}
        </div>
      )}
      {fetchError ? (
        <p className="m-0 text-xs leading-[1.4] text-destructive">
          {fetchError}
        </p>
      ) : null}
    </div>
  );
}
