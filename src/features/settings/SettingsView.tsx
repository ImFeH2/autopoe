import { useEffect, useState } from "react";
import { Button, Switch, Tabs, TextField } from "@radix-ui/themes";
import { Check, Cpu, GitBranch, KeyRound, Save, Trash2 } from "lucide-react";
import { ModelConfigurationFields } from "@/components/ModelConfigurationFields";
import { defaultModelConfiguration } from "@/lib/models";
import { runtimeRequest } from "@/lib/runtime";
import type { SettingsResponse } from "@/types/runtime";
import type { ModelConfiguration } from "@/types/workflow";

interface SettingsSaveButtonProps {
  disabled: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}

function SettingsSaveButton({
  disabled,
  saved,
  saving,
  onSave,
}: SettingsSaveButtonProps) {
  return (
    <Button
      className="primary-button"
      disabled={disabled}
      loading={saving}
      onClick={onSave}
    >
      {saved ? (
        <Check size={14} strokeWidth={1.8} />
      ) : (
        <Save size={14} strokeWidth={1.8} />
      )}
      {saved ? "Saved" : "Save"}
    </Button>
  );
}

export function SettingsView() {
  const [configuration, setConfiguration] = useState<ModelConfiguration>({
    ...defaultModelConfiguration,
  });
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [credentialStoreAvailable, setCredentialStoreAvailable] =
    useState(true);
  const [worktrees, setWorktrees] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void runtimeRequest<SettingsResponse>("settings.get")
      .then((response) => {
        if (!active || !response?.model) {
          return;
        }
        setConfiguration(response.model);
        setHasApiKey(response.has_api_key);
        setCredentialStoreAvailable(response.credential_store_available);
        setWorktrees(response.runtime.default_workspace_mode === "worktree");
        setSaved(true);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
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

  function changeConfiguration(model: ModelConfiguration) {
    if (model.provider !== configuration.provider) {
      setApiKey("");
      setHasApiKey(false);
    }
    setConfiguration(model);
    setSaved(false);
    setError(null);
  }

  async function saveSettings(clearApiKey = false) {
    setSaving(true);
    setError(null);
    try {
      const response = await runtimeRequest<SettingsResponse>("settings.save", {
        model: configuration,
        runtime: {
          default_workspace_mode: worktrees ? "worktree" : "direct",
        },
        ...(apiKey ? { api_key: apiKey } : {}),
        clear_api_key: clearApiKey,
      });
      setConfiguration(response.model);
      setHasApiKey(response.has_api_key);
      setCredentialStoreAvailable(response.credential_store_available);
      setApiKey("");
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = loading || saving || saved;
  const credentialDisabled =
    configuration.provider === "demo" || !credentialStoreAvailable;

  return (
    <section className="settings-view">
      <Tabs.Root defaultValue="models" orientation="vertical">
        <Tabs.List className="settings-nav">
          <Tabs.Trigger value="models">Models</Tabs.Trigger>
          <Tabs.Trigger value="runtime">Runtime</Tabs.Trigger>
        </Tabs.List>

        <div className="settings-content">
          <Tabs.Content value="models">
            <div className="settings-title-row">
              <div>
                <span className="eyebrow">Settings</span>
                <h2>Models</h2>
              </div>
              <SettingsSaveButton
                disabled={saveDisabled}
                onSave={() => void saveSettings()}
                saved={saved}
                saving={saving}
              />
            </div>

            <div className="settings-card">
              <div className="settings-card-icon">
                <Cpu size={18} strokeWidth={1.6} />
              </div>
              <div className="settings-card-body">
                <strong>Default model</strong>
                <ModelConfigurationFields
                  model={configuration}
                  onChange={changeConfiguration}
                />
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-icon">
                <KeyRound size={18} strokeWidth={1.6} />
              </div>
              <div className="settings-card-body">
                <div className="settings-card-heading">
                  <strong>Credential</strong>
                  {hasApiKey ? (
                    <Button
                      aria-label="Remove API key"
                      color="red"
                      disabled={saving}
                      onClick={() => void saveSettings(true)}
                      size="1"
                      variant="ghost"
                    >
                      <Trash2 size={13} strokeWidth={1.7} />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <label className="field-label">
                  <span>API key</span>
                  <TextField.Root
                    disabled={credentialDisabled}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setSaved(false);
                    }}
                    placeholder={hasApiKey ? "Stored securely" : "Not set"}
                    type="password"
                    value={apiKey}
                    variant="surface"
                  />
                </label>
                {!credentialStoreAvailable ? (
                  <span className="settings-error">System keychain unavailable</span>
                ) : null}
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="runtime">
            <div className="settings-title-row">
              <div>
                <span className="eyebrow">Settings</span>
                <h2>Runtime</h2>
              </div>
              <SettingsSaveButton
                disabled={saveDisabled}
                onSave={() => void saveSettings()}
                saved={saved}
                saving={saving}
              />
            </div>
            <div className="settings-card settings-card-toggle">
              <div className="settings-card-icon">
                <GitBranch size={18} strokeWidth={1.6} />
              </div>
              <div className="settings-card-body settings-toggle-body">
                <div>
                  <strong>Git worktrees</strong>
                  <span className="setting-value">
                    {worktrees ? "Default" : "Off"}
                  </span>
                </div>
                <Switch
                  checked={worktrees}
                  onCheckedChange={(checked) => {
                    setWorktrees(checked);
                    setSaved(false);
                  }}
                />
              </div>
            </div>
          </Tabs.Content>

          {error ? (
            <div className="settings-error settings-page-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </Tabs.Root>
    </section>
  );
}
