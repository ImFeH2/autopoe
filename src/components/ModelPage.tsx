import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsHeader, type SettingsPage } from "@/components/SettingsHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarInset } from "@/components/ui/sidebar";
import {
  getDefaultModel,
  type ModelSelection,
  setDefaultModel,
} from "@/lib/models";
import {
  fetchProviderModels,
  listProviders,
  type Provider,
  type ProviderModel,
} from "@/lib/providers";

interface ModelPageProps {
  onNavigate: (page: SettingsPage) => void;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ModelPage({ onNavigate }: ModelPageProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [saved, setSaved] = useState<ModelSelection | null>(null);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([listProviders(), getDefaultModel()])
      .then(([items, selection]) => {
        if (!active) {
          return;
        }
        const provider = selection
          ? items.find((item) => item.id === selection.providerId)
          : null;
        const selectedProviderId = provider?.id ?? items[0]?.id ?? "";
        const selectedModelId = provider ? (selection?.modelId ?? "") : "";
        setProviders(items);
        setSaved(selection);
        setProviderId(selectedProviderId);
        setModelId(selectedModelId);
        setModels(
          selectedModelId
            ? [{ id: selectedModelId, name: selectedModelId }]
            : null,
        );
      })
      .catch((reason) => {
        if (active) {
          setError(messageOf(reason));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const busy = loading || fetching || saving;
  const dirty =
    providerId !== (saved?.providerId ?? "") ||
    modelId !== (saved?.modelId ?? "");
  const options = models
    ? modelId && !models.some((model) => model.id === modelId)
      ? [{ id: modelId, name: modelId }, ...models]
      : models
    : [];

  const changeProvider = (value: string) => {
    setProviderId(value);
    setModelId(saved?.providerId === value ? saved.modelId : "");
    setModels(
      saved?.providerId === value
        ? [{ id: saved.modelId, name: saved.modelId }]
        : null,
    );
    setError(null);
  };

  const fetchModels = async () => {
    if (!providerId || fetching) {
      return;
    }
    setFetching(true);
    setError(null);
    try {
      setModels(await fetchProviderModels(providerId));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    if (!providerId || !modelId || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const selection = await setDefaultModel({ providerId, modelId });
      setSaved(selection);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidebarInset className="h-svh overflow-hidden">
      <SettingsHeader activePage="model" onNavigate={onNavigate} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl p-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Default model</CardTitle>
              <CardAction className="flex gap-2">
                <Button
                  disabled={!providerId || busy}
                  onClick={fetchModels}
                  variant="outline"
                >
                  {fetching ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  Fetch
                </Button>
                <Button
                  disabled={!providerId || !modelId || !dirty || busy}
                  onClick={save}
                >
                  {saving ? <LoaderCircle className="animate-spin" /> : null}
                  Save
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-5">
              {error ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {providers.length ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="default-provider">Provider</FieldLabel>
                    <Select
                      disabled={busy}
                      onValueChange={changeProvider}
                      value={providerId}
                    >
                      <SelectTrigger className="w-full" id="default-provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="default-model">Model</FieldLabel>
                    <Select
                      disabled={busy || options.length === 0}
                      onValueChange={setModelId}
                      value={modelId}
                    >
                      <SelectTrigger className="w-full" id="default-model">
                        <SelectValue
                          placeholder={
                            models
                              ? models.length
                                ? "Select model"
                                : "No models"
                              : "Fetch models"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              ) : loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    No providers
                  </span>
                  <Button
                    onClick={() => onNavigate("providers")}
                    variant="outline"
                  >
                    Providers
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SidebarInset>
  );
}
