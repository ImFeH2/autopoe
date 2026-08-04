import {
  CircleAlert,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsHeader, type SettingsPage } from "@/components/SettingsHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SidebarInset } from "@/components/ui/sidebar";
import {
  deleteProvider,
  fetchProviderModels,
  listProviders,
  type Provider,
  type ProviderModel,
  type ProviderType,
  providerType,
  providerTypes,
  saveProvider,
} from "@/lib/providers";
import { deleteProviderSecret, setProviderSecret } from "@/lib/secrets";

interface ProviderForm {
  id: string | null;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
}

interface ProvidersPageProps {
  onNavigate: (page: SettingsPage) => void;
}

function newProvider(): ProviderForm {
  const type = providerTypes[0];
  return {
    id: null,
    name: "",
    type: type.value,
    baseUrl: type.baseUrl,
    apiKey: "",
  };
}

function editProvider(provider: Provider): ProviderForm {
  return { ...provider, apiKey: "" };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ProvidersPage({ onNavigate }: ProvidersPageProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<ProviderForm>(newProvider);
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    listProviders()
      .then((items) => {
        if (!active) {
          return;
        }
        setProviders(items);
        if (items[0]) {
          setForm(editProvider(items[0]));
        }
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

  const saved = providers.find((provider) => provider.id === form.id);
  const dirty =
    form.apiKey.trim() !== "" ||
    (saved
      ? saved.name !== form.name.trim() ||
        saved.type !== form.type ||
        saved.baseUrl !== form.baseUrl.trim()
      : true);
  const busy = loading || saving || fetching || deleting;
  const valid = form.name.trim() !== "" && form.baseUrl.trim() !== "";

  const select = (provider: Provider) => {
    setForm(editProvider(provider));
    setModels(null);
    setError(null);
  };

  const create = () => {
    setForm(newProvider());
    setModels(null);
    setError(null);
  };

  const changeType = (type: ProviderType) => {
    setForm((current) => ({
      ...current,
      type,
      baseUrl: providerType(type).baseUrl,
    }));
    setModels(null);
  };

  const save = async () => {
    if (!valid || saving) {
      return;
    }
    if (
      !form.id &&
      providerType(form.type).requiresApiKey &&
      !form.apiKey.trim()
    ) {
      setError("API key is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const provider = await saveProvider(form);
      const apiKey = form.apiKey.trim();
      setProviders((items) => {
        const next = items.filter((item) => item.id !== provider.id);
        return [...next, provider].sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      });
      setForm({ ...editProvider(provider), apiKey: form.apiKey });
      if (apiKey) {
        await setProviderSecret(provider.id, apiKey);
      }
      setForm(editProvider(provider));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };

  const fetchModels = async () => {
    if (!form.id || dirty || fetching) {
      return;
    }

    setFetching(true);
    setError(null);
    try {
      setModels(await fetchProviderModels(form.id));
    } catch (reason) {
      setModels(null);
      setError(messageOf(reason));
    } finally {
      setFetching(false);
    }
  };

  const remove = async () => {
    if (!form.id || deleting) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      await deleteProviderSecret(form.id);
      await deleteProvider(form.id);
      const remaining = providers.filter((provider) => provider.id !== form.id);
      setProviders(remaining);
      setForm(remaining[0] ? editProvider(remaining[0]) : newProvider());
      setModels(null);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SidebarInset className="h-svh overflow-hidden">
      <SettingsHeader activePage="providers" onNavigate={onNavigate} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid w-full max-w-5xl gap-4 p-6 md:grid-cols-[15rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Providers</CardTitle>
              <CardAction>
                <Button
                  aria-label="New provider"
                  disabled={busy}
                  onClick={create}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Plus />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading
                </div>
              ) : providers.length ? (
                <div className="grid gap-1">
                  {providers.map((provider) => (
                    <Button
                      className="h-auto justify-start px-2 py-2 text-left"
                      disabled={busy}
                      key={provider.id}
                      onClick={() => select(provider)}
                      variant={provider.id === form.id ? "secondary" : "ghost"}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{provider.name}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {providerType(provider.type).label}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  No providers
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle>
                {form.id ? form.name || "Provider" : "New provider"}
              </CardTitle>
              <CardAction className="flex gap-2">
                <Button
                  disabled={!form.id || dirty || busy}
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
                <Button disabled={!valid || !dirty || busy} onClick={save}>
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

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="provider-name">Name</FieldLabel>
                  <Input
                    disabled={busy}
                    id="provider-name"
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      setForm((current) => ({
                        ...current,
                        name,
                      }));
                    }}
                    value={form.name}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="provider-type">Type</FieldLabel>
                  <Select
                    disabled={busy}
                    onValueChange={(value) => changeType(value as ProviderType)}
                    value={form.type}
                  >
                    <SelectTrigger className="w-full" id="provider-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providerTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="provider-base-url">Base URL</FieldLabel>
                  <Input
                    disabled={busy}
                    id="provider-base-url"
                    onChange={(event) => {
                      const baseUrl = event.currentTarget.value;
                      setForm((current) => ({
                        ...current,
                        baseUrl,
                      }));
                      setModels(null);
                    }}
                    spellCheck={false}
                    value={form.baseUrl}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="provider-api-key">API key</FieldLabel>
                  <Input
                    autoComplete="off"
                    disabled={busy}
                    id="provider-api-key"
                    onChange={(event) => {
                      const apiKey = event.currentTarget.value;
                      setForm((current) => ({
                        ...current,
                        apiKey,
                      }));
                    }}
                    placeholder={form.id ? "Stored" : ""}
                    type="password"
                    value={form.apiKey}
                  />
                </Field>
              </FieldGroup>

              <Separator />

              <section className="grid gap-3">
                <h2 className="text-sm font-medium">Models</h2>
                {models ? (
                  models.length ? (
                    <ScrollArea className="h-48 rounded-lg border">
                      <div className="divide-y">
                        {models.map((model) => (
                          <div className="px-3 py-2" key={model.id}>
                            <p className="text-sm">{model.name}</p>
                            {model.name !== model.id ? (
                              <p className="text-xs text-muted-foreground">
                                {model.id}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-sm text-muted-foreground">No models</p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">Not fetched</p>
                )}
              </section>

              {form.id ? (
                <div className="flex justify-end">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button disabled={busy} variant="destructive">
                        <Trash2 />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete provider?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes its settings and API key.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={remove}
                          variant="destructive"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SidebarInset>
  );
}
