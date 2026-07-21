import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
import { providerOptions } from "@/features/providers/model/provider-options";
import type { Provider } from "@/features/providers/model/provider-types";
import { cn } from "@/lib/utils";

export function ProvidersView({
  activeProvider,
  isFetchingModels,
  isCreatingProvider,
  onFetchModels,
  onNewProvider,
  onProviderSelect,
  onRemoveProvider,
  onSaveProvider,
  onUpdateProvider,
  providers,
}: {
  activeProvider: Provider;
  isFetchingModels: boolean;
  isCreatingProvider: boolean;
  onFetchModels: () => void;
  onNewProvider: () => void;
  onProviderSelect: (provider: Provider) => void;
  onRemoveProvider: () => void;
  onSaveProvider: () => void;
  onUpdateProvider: (updates: Partial<Provider>) => void;
  providers: Provider[];
}) {
  const { t } = useTranslation();

  return (
    <section
      className="grid h-full min-h-0 bg-black"
      aria-label={t("setup.providers.page")}
    >
      <div className="grid h-full min-h-0 grid-cols-[232px_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
        <ProviderSidebar
          activeProvider={activeProvider}
          isCreatingProvider={isCreatingProvider}
          onNewProvider={onNewProvider}
          onProviderSelect={onProviderSelect}
          providers={providers}
        />
        <ProviderDetails
          activeProvider={activeProvider}
          isFetchingModels={isFetchingModels}
          isCreatingProvider={isCreatingProvider}
          onFetchModels={onFetchModels}
          onRemoveProvider={onRemoveProvider}
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
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-auto border-r border-white/10 bg-black p-3 max-[900px]:max-h-64 max-[900px]:border-r-0 max-[900px]:border-b",
        stableScrollbarClassName,
      )}
      aria-label={t("setup.providers.list")}
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
        {t("setup.providers.new")}
      </Button>
      <div className="mt-4 -mx-1 grid gap-0">
        {providers.length === 0 ? (
          <p className={emptyStateClassName}>
            {t("setup.providers.noProviders")}
          </p>
        ) : null}
        {providers.map((provider) => {
          const isActive =
            !isCreatingProvider && activeProvider.id === provider.id;

          return (
            <Button
              aria-label={provider.name}
              aria-pressed={isActive}
              className={cn(
                "flowent-navigation-item grid w-full cursor-pointer justify-start rounded-lg border border-transparent bg-transparent px-2 py-1 text-left text-white/90 shadow-none transition-colors duration-100 hover:bg-[#151515] hover:text-white",
                navigationLabelClassName,
                isActive && "bg-[#202020] text-white",
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
  isFetchingModels,
  isCreatingProvider,
  onFetchModels,
  onRemoveProvider,
  onSaveProvider,
  onUpdateProvider,
}: {
  activeProvider: Provider;
  isFetchingModels: boolean;
  isCreatingProvider: boolean;
  onFetchModels: () => void;
  onRemoveProvider: () => void;
  onSaveProvider: () => void;
  onUpdateProvider: (updates: Partial<Provider>) => void;
}) {
  const { t } = useTranslation();

  return (
    <form
      className={cn(
        "grid min-h-0 w-full content-start gap-7 overflow-auto px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
      aria-label={t("setup.providers.detailsAria")}
      onSubmit={(event) => {
        event.preventDefault();
        onSaveProvider();
      }}
    >
      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">
          {t("setup.providers.details")}
        </h3>
        <div className={dashedPanelClassName}>
          <ProviderFields
            activeProvider={activeProvider}
            onUpdateProvider={onUpdateProvider}
          />
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-white">
          {t("setup.providers.models")}
        </h3>
        <ProviderModels models={activeProvider.models} />
      </section>

      <div className={cn(formActionsClassName, "mt-0")}>
        <Button
          className={subtleButtonClassName}
          disabled={isFetchingModels}
          onClick={onFetchModels}
          type="button"
          variant="outline"
        >
          {isFetchingModels
            ? t("setup.providers.fetching")
            : t("setup.providers.fetch")}
        </Button>
        {!isCreatingProvider ? (
          <Button
            className={subtleButtonClassName}
            onClick={onRemoveProvider}
            type="button"
            variant="outline"
          >
            <Trash2 aria-hidden="true" />
            {t("setup.providers.remove")}
          </Button>
        ) : null}
        <Button type="submit">{t("setup.providers.save")}</Button>
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
  const { t } = useTranslation();

  return (
    <>
      <div className={dataRowClassName}>
        <Label
          className={cn(fieldLabelClassName, dataRowLabelClassName)}
          htmlFor="provider-name"
        >
          {t("setup.providers.name")}
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
          {t("setup.providers.type")}
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
            aria-label={t("setup.providers.type")}
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
          {t("setup.providers.baseUrl")}
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
          htmlFor="provider-access-key"
        >
          {t("setup.providers.accessKey")}
        </Label>
        <Input
          className={fieldInputClassName}
          id="provider-access-key"
          onChange={(event) => onUpdateProvider({ apiKey: event.target.value })}
          placeholder={
            activeProvider.hasAccessKey && !activeProvider.apiKey
              ? t("setup.providers.saved")
              : undefined
          }
          type="password"
          value={activeProvider.apiKey}
        />
      </div>
    </>
  );
}

function ProviderModels({ models }: { models: string[] }) {
  const { t } = useTranslation();

  return (
    <div className={fieldGroupClassName}>
      {models.length === 0 ? (
        <p className={emptyStateClassName}>{t("setup.providers.noModels")}</p>
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
    </div>
  );
}
