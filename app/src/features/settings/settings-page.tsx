import { type FormEvent, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button, Checkbox, Input, SegmentedControl, X } from "@/components/ui";
import {
  backend,
  type ExecutionBackend,
  type ExecutionSettings,
  type ModelApiType,
  type ModelSettings,
  type ObservabilitySettings,
} from "@/lib/backend";

type ModelSettingsDraft = {
  apiType: ModelApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: string;
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

export function isExecutionSettingsDirty(
  current: ExecutionSettings | null,
  backend: ExecutionBackend,
  writeDirectories: string[] = current?.write_directories ?? [],
): boolean {
  return (
    current !== null &&
    (backend !== current.selected_backend ||
      writeDirectories.length !== current.write_directories.length ||
      writeDirectories.some(
        (path, index) => path !== current.write_directories[index],
      ))
  );
}

export function parseContextWindow(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 2) {
    throw new Error("Context window must be an integer of at least 2");
  }
  return parsed;
}

export function isModelSettingsDirty(
  current: ModelSettings | null,
  draft: ModelSettingsDraft,
): boolean {
  return (
    draft.apiType !== (current?.api_type ?? "openai-chat") ||
    draft.baseUrl !== (current?.base_url ?? "") ||
    draft.apiKey.length > 0 ||
    draft.model !== (current?.model ?? "") ||
    draft.contextWindow !== (current?.context_window?.toString() ?? "")
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
  const [executionSettings, setExecutionSettings] =
    useState<ExecutionSettings | null>(null);
  const [executionBackend, setExecutionBackend] =
    useState<ExecutionBackend>("native");
  const [writeDirectories, setWriteDirectories] = useState<string[]>([]);
  const [writeDirectory, setWriteDirectory] = useState("");
  const [executionStatus, setExecutionStatus] = useState<
    "loading" | "ready" | "saving" | "saved"
  >("loading");
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(
    null,
  );
  const [apiType, setApiType] = useState<ModelApiType>("openai-chat");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [contextWindow, setContextWindow] = useState("");
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
      .getExecutionSettings()
      .then((current) => {
        if (!active) {
          return;
        }
        setExecutionSettings(current);
        setExecutionBackend(current.selected_backend);
        setWriteDirectories(current.write_directories);
        setExecutionStatus("ready");
      })
      .catch((reason) => {
        if (active) {
          setExecutionError(errorMessage(reason));
          setExecutionStatus("ready");
        }
      });
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
        setContextWindow(current.context_window?.toString() ?? "");
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

  async function handleSaveExecution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExecutionStatus("saving");
    setExecutionError(null);
    try {
      const current = await backend.updateExecutionSettings({
        backend: executionBackend,
        write_directories: writeDirectories,
      });
      setExecutionSettings(current);
      setExecutionBackend(current.selected_backend);
      setWriteDirectories(current.write_directories);
      setExecutionStatus("saved");
    } catch (reason) {
      setExecutionError(errorMessage(reason));
      setExecutionStatus("ready");
    }
  }

  function addWriteDirectory() {
    const path = writeDirectory.trim();
    if (!path || writeDirectories.includes(path)) {
      return;
    }
    setWriteDirectories([...writeDirectories, path]);
    setWriteDirectory("");
  }

  function removeWriteDirectory(path: string) {
    setWriteDirectories(writeDirectories.filter((item) => item !== path));
  }

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
        context_window: parseContextWindow(contextWindow),
      });
      setModelSettings(current);
      setApiType(current.api_type);
      setBaseUrl(current.base_url);
      setApiKey("");
      setModel(current.model);
      setContextWindow(current.context_window?.toString() ?? "");
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

  const executionBusy =
    executionStatus === "loading" || executionStatus === "saving";
  const executionDirty = isExecutionSettingsDirty(
    executionSettings,
    executionBackend,
    writeDirectories,
  );
  const executionOptions: Array<{
    label: string;
    value: ExecutionBackend;
  }> = [
    { label: "Windows", value: "native" },
    ...(executionSettings?.wsl_available
      ? [
          {
            label: `WSL · ${executionSettings.wsl_distribution}`,
            value: "wsl" as const,
          },
        ]
      : []),
  ];
  const modelBusy = modelStatus === "loading" || modelStatus === "saving";
  const tracingBusy = tracingStatus === "loading" || tracingStatus === "saving";
  const modelDirty = isModelSettingsDirty(modelSettings, {
    apiType,
    baseUrl,
    apiKey,
    model,
    contextWindow,
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
          <h3 className="settings-section-title">Execution</h3>
          <form
            className="settings-form"
            aria-label="Execution settings"
            onSubmit={handleSaveExecution}
          >
            {executionSettings?.platform === "windows" ? (
              <fieldset className="settings-segmented-field">
                <legend id="execution-environment-label">Environment</legend>
                <SegmentedControl
                  aria-labelledby="execution-environment-label"
                  disabled={executionBusy}
                  onValueChange={setExecutionBackend}
                  options={executionOptions}
                  value={executionBackend}
                />
              </fieldset>
            ) : null}
            <fieldset className="settings-directory-field">
              <legend>Writable directories</legend>
              <div className="settings-directory-input">
                <Input
                  aria-label="Writable directory"
                  autoComplete="off"
                  disabled={executionBusy}
                  onChange={(event) => setWriteDirectory(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addWriteDirectory();
                    }
                  }}
                  placeholder={
                    executionSettings?.platform === "windows" &&
                    executionBackend === "native"
                      ? "C:\\Projects"
                      : "/path/to/project"
                  }
                  value={writeDirectory}
                />
                <Button
                  disabled={executionBusy || !writeDirectory.trim()}
                  onClick={addWriteDirectory}
                  size="compact"
                >
                  Add
                </Button>
              </div>
              {writeDirectories.length > 0 ? (
                <ul className="settings-directory-list">
                  {writeDirectories.map((path) => (
                    <li key={path}>
                      <span>{path}</span>
                      <Button
                        aria-label={`Remove ${path}`}
                        disabled={executionBusy}
                        onClick={() => removeWriteDirectory(path)}
                        size="icon"
                        variant="quiet"
                      >
                        <X aria-hidden="true" size={14} />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="settings-directory-empty">
                  {executionSettings?.platform === "windows" &&
                  executionBackend === "native"
                    ? "Restricted"
                    : "Read only"}
                </span>
              )}
              {executionSettings?.platform === "windows" &&
              executionSettings.active_backend === "native" ? (
                <span className="caption-text text-muted">
                  Locations writable by Everyone may also be changed.
                </span>
              ) : null}
            </fieldset>
            <div className="settings-actions">
              <Button
                disabled={executionBusy || !executionDirty}
                type="submit"
                variant="primary"
              >
                {executionStatus === "saving" ? "Saving" : "Save execution"}
              </Button>
              {!executionDirty &&
              executionSettings &&
              (executionSettings.restart_required ||
                executionStatus === "saved") ? (
                <span
                  className={
                    executionSettings.restart_required
                      ? "settings-restart-required"
                      : undefined
                  }
                  role="status"
                >
                  {executionSettings.restart_required
                    ? "Restart required"
                    : "Saved"}
                </span>
              ) : null}
            </div>
            {executionError ? (
              <p className="caption-text m-0 text-danger" role="alert">
                {executionError}
              </p>
            ) : null}
          </form>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">Model</h3>
          <form
            className="settings-form"
            aria-label="Model settings"
            onSubmit={handleSaveModel}
          >
            <fieldset className="settings-segmented-field">
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
            <label className="settings-field" htmlFor="model-context-window">
              <span>Context window</span>
              <Input
                aria-label="Context window"
                id="model-context-window"
                autoComplete="off"
                disabled={modelBusy}
                inputMode="numeric"
                min={2}
                onChange={(event) => setContextWindow(event.target.value)}
                placeholder="1050000"
                step={1}
                type="number"
                value={contextWindow}
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
