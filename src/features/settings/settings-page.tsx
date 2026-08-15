import { type FormEvent, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button, Checkbox, Input, SegmentedControl } from "@/components/ui";
import {
  backend,
  type ModelApiType,
  type ModelSettings,
  type ObservabilitySettings,
} from "@/lib/backend";

type ModelSettingsDraft = {
  apiType: ModelApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ObservabilitySettingsDraft = {
  enabled: boolean;
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  environment: string;
  captureContent: boolean;
};

const apiTypeOptions: Array<{ label: string; value: ModelApiType }> = [
  { label: "Chat", value: "openai-chat" },
  { label: "Responses", value: "openai-responses" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Google", value: "google" },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isModelSettingsDirty(
  current: ModelSettings | null,
  draft: ModelSettingsDraft,
): boolean {
  return (
    draft.apiType !== (current?.api_type ?? "openai-chat") ||
    draft.baseUrl !== (current?.base_url ?? "") ||
    draft.apiKey.length > 0 ||
    draft.model !== (current?.model ?? "")
  );
}

export function isObservabilitySettingsDirty(
  current: ObservabilitySettings | null,
  draft: ObservabilitySettingsDraft,
): boolean {
  return (
    draft.enabled !== (current?.enabled ?? false) ||
    draft.baseUrl !== (current?.base_url ?? "") ||
    draft.publicKey !== (current?.public_key ?? "") ||
    draft.secretKey.length > 0 ||
    draft.environment !== (current?.environment ?? "development") ||
    draft.captureContent !== (current?.capture_content ?? false)
  );
}

export function SettingsPage() {
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(
    null,
  );
  const [apiType, setApiType] = useState<ModelApiType>("openai-chat");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [modelStatus, setModelStatus] = useState<
    "loading" | "ready" | "saving" | "saved"
  >("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [tracingSettings, setTracingSettings] =
    useState<ObservabilitySettings | null>(null);
  const [tracingEnabled, setTracingEnabled] = useState(false);
  const [tracingBaseUrl, setTracingBaseUrl] = useState("");
  const [tracingPublicKey, setTracingPublicKey] = useState("");
  const [tracingSecretKey, setTracingSecretKey] = useState("");
  const [tracingEnvironment, setTracingEnvironment] = useState("development");
  const [captureContent, setCaptureContent] = useState(false);
  const [tracingStatus, setTracingStatus] = useState<
    "loading" | "ready" | "saving" | "saved"
  >("loading");
  const [tracingError, setTracingError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void backend
      .getModelSettings()
      .then((current) => {
        if (!active) {
          return;
        }
        setModelSettings(current);
        setApiType(current.api_type);
        setBaseUrl(current.base_url);
        setModel(current.model);
        setModelStatus("ready");
      })
      .catch((reason) => {
        if (active) {
          setModelError(errorMessage(reason));
          setModelStatus("ready");
        }
      });
    void backend
      .getObservabilitySettings()
      .then((current) => {
        if (!active) {
          return;
        }
        setTracingSettings(current);
        setTracingEnabled(current.enabled);
        setTracingBaseUrl(current.base_url);
        setTracingPublicKey(current.public_key);
        setTracingEnvironment(current.environment);
        setCaptureContent(current.capture_content);
        setTracingStatus("ready");
      })
      .catch((reason) => {
        if (active) {
          setTracingError(errorMessage(reason));
          setTracingStatus("ready");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setModelStatus("saving");
    setModelError(null);
    try {
      const current = await backend.updateModelSettings({
        api_type: apiType,
        base_url: baseUrl,
        api_key: apiKey,
        model,
      });
      setModelSettings(current);
      setApiType(current.api_type);
      setBaseUrl(current.base_url);
      setApiKey("");
      setModel(current.model);
      setModelStatus("saved");
    } catch (reason) {
      setModelError(errorMessage(reason));
      setModelStatus("ready");
    }
  }

  async function handleSaveTracing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTracingStatus("saving");
    setTracingError(null);
    try {
      const current = await backend.updateObservabilitySettings({
        enabled: tracingEnabled,
        base_url: tracingBaseUrl,
        public_key: tracingPublicKey,
        secret_key: tracingSecretKey,
        environment: tracingEnvironment,
        capture_content: captureContent,
      });
      setTracingSettings(current);
      setTracingEnabled(current.enabled);
      setTracingBaseUrl(current.base_url);
      setTracingPublicKey(current.public_key);
      setTracingSecretKey("");
      setTracingEnvironment(current.environment);
      setCaptureContent(current.capture_content);
      setTracingStatus("saved");
    } catch (reason) {
      setTracingError(errorMessage(reason));
      setTracingStatus("ready");
    }
  }

  const modelBusy = modelStatus === "loading" || modelStatus === "saving";
  const tracingBusy = tracingStatus === "loading" || tracingStatus === "saving";
  const modelDirty = isModelSettingsDirty(modelSettings, {
    apiType,
    baseUrl,
    apiKey,
    model,
  });
  const tracingDirty = isObservabilitySettingsDirty(tracingSettings, {
    enabled: tracingEnabled,
    baseUrl: tracingBaseUrl,
    publicKey: tracingPublicKey,
    secretKey: tracingSecretKey,
    environment: tracingEnvironment,
    captureContent,
  });
  const hasApiKey = modelSettings?.has_api_key ?? false;
  const hasTracingSecretKey = tracingSettings?.has_secret_key ?? false;

  return (
    <section className="page-pane page-pane--settings">
      <PageHeader title="Settings" />
      <div className="settings-scroll">
        <section className="settings-section">
          <h3 className="settings-section-title">Model</h3>
          <form
            className="settings-form"
            aria-label="Model settings"
            onSubmit={handleSaveModel}
          >
            <fieldset className="settings-api-type">
              <legend id="model-api-type-label">API type</legend>
              <SegmentedControl
                aria-labelledby="model-api-type-label"
                disabled={modelBusy}
                onValueChange={setApiType}
                options={apiTypeOptions}
                value={apiType}
              />
            </fieldset>
            <label className="settings-field" htmlFor="model-base-url">
              <span>Base URL</span>
              <Input
                aria-label="Base URL"
                id="model-base-url"
                autoComplete="url"
                disabled={modelBusy}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com"
                required
                type="url"
                value={baseUrl}
              />
            </label>
            <label className="settings-field" htmlFor="model-api-key">
              <span>API key</span>
              <Input
                aria-label="API key"
                id="model-api-key"
                autoComplete="new-password"
                disabled={modelBusy}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasApiKey ? "Saved" : "API key"}
                required={!hasApiKey}
                type="password"
                value={apiKey}
              />
            </label>
            <label className="settings-field" htmlFor="model-name">
              <span>Model</span>
              <Input
                aria-label="Model"
                id="model-name"
                autoComplete="off"
                disabled={modelBusy}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Model"
                required
                value={model}
              />
            </label>
            <div className="settings-actions">
              <Button
                disabled={modelBusy || !modelDirty}
                type="submit"
                variant="primary"
              >
                {modelStatus === "saving" ? "Saving" : "Save model"}
              </Button>
              {modelStatus === "saved" && !modelDirty ? (
                <span role="status">Saved</span>
              ) : null}
            </div>
            {modelError ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {modelError}
              </p>
            ) : null}
          </form>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">Tracing</h3>
          <form
            className="settings-form"
            aria-label="Tracing settings"
            onSubmit={handleSaveTracing}
          >
            <label className="settings-toggle" htmlFor="tracing-enabled">
              <Checkbox
                checked={tracingEnabled}
                disabled={tracingBusy}
                id="tracing-enabled"
                onChange={(event) => setTracingEnabled(event.target.checked)}
              />
              Enable Langfuse
            </label>
            <label className="settings-field" htmlFor="tracing-base-url">
              <span>Host</span>
              <Input
                aria-label="Langfuse host"
                id="tracing-base-url"
                autoComplete="url"
                disabled={tracingBusy}
                onChange={(event) => setTracingBaseUrl(event.target.value)}
                placeholder="https://cloud.langfuse.com"
                required={tracingEnabled}
                type="url"
                value={tracingBaseUrl}
              />
            </label>
            <label className="settings-field" htmlFor="tracing-public-key">
              <span>Public key</span>
              <Input
                aria-label="Langfuse public key"
                id="tracing-public-key"
                autoComplete="off"
                disabled={tracingBusy}
                onChange={(event) => setTracingPublicKey(event.target.value)}
                placeholder="pk-lf-..."
                required={tracingEnabled}
                value={tracingPublicKey}
              />
            </label>
            <label className="settings-field" htmlFor="tracing-secret-key">
              <span>Secret key</span>
              <Input
                aria-label="Langfuse secret key"
                id="tracing-secret-key"
                autoComplete="new-password"
                disabled={tracingBusy}
                onChange={(event) => setTracingSecretKey(event.target.value)}
                placeholder={hasTracingSecretKey ? "Saved" : "sk-lf-..."}
                required={tracingEnabled && !hasTracingSecretKey}
                type="password"
                value={tracingSecretKey}
              />
            </label>
            <label className="settings-field" htmlFor="tracing-environment">
              <span>Environment</span>
              <Input
                aria-label="Tracing environment"
                id="tracing-environment"
                autoComplete="off"
                disabled={tracingBusy}
                onChange={(event) => setTracingEnvironment(event.target.value)}
                placeholder="development"
                required={tracingEnabled}
                value={tracingEnvironment}
              />
            </label>
            <label className="settings-toggle" htmlFor="capture-content">
              <Checkbox
                checked={captureContent}
                disabled={tracingBusy}
                id="capture-content"
                onChange={(event) => setCaptureContent(event.target.checked)}
              />
              Capture content
            </label>
            <div className="settings-actions">
              <Button
                disabled={tracingBusy || !tracingDirty}
                type="submit"
                variant="primary"
              >
                {tracingStatus === "saving" ? "Saving" : "Save tracing"}
              </Button>
              {tracingStatus === "saved" && !tracingDirty ? (
                <span role="status">Saved</span>
              ) : null}
            </div>
            {tracingError ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {tracingError}
              </p>
            ) : null}
          </form>
        </section>
      </div>
    </section>
  );
}
