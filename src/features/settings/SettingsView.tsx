import { useState } from "react";
import {
  Button,
  Select,
  Switch,
  Tabs,
  TextField,
} from "@radix-ui/themes";
import { Check, Cpu, KeyRound, Save } from "lucide-react";

export function SettingsView() {
  const [saved, setSaved] = useState(true);
  const [provider, setProvider] = useState("demo");
  const [model, setModel] = useState("flowent-demo");
  const [apiKey, setApiKey] = useState("");
  const [worktrees, setWorktrees] = useState(true);

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
              <Button
                className="primary-button"
                onClick={() => setSaved(true)}
              >
                {saved ? (
                  <Check size={14} strokeWidth={1.8} />
                ) : (
                  <Save size={14} strokeWidth={1.8} />
                )}
                {saved ? "Saved" : "Save"}
              </Button>
            </div>

            <div className="settings-card">
              <div className="settings-card-icon">
                <Cpu size={18} strokeWidth={1.6} />
              </div>
              <div className="settings-card-body">
                <strong>Default model</strong>
                <div className="settings-fields">
                  <label className="field-label">
                    <span>Provider</span>
                    <Select.Root
                      onValueChange={(value) => {
                        setProvider(value);
                        setSaved(false);
                      }}
                      value={provider}
                    >
                      <Select.Trigger className="field-select" />
                      <Select.Content>
                        <Select.Item value="demo">Local demo</Select.Item>
                        <Select.Item value="openai">OpenAI</Select.Item>
                        <Select.Item value="openai_compatible">
                          OpenAI compatible
                        </Select.Item>
                        <Select.Item value="anthropic">Anthropic</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </label>
                  <label className="field-label">
                    <span>Model</span>
                    <TextField.Root
                      onChange={(event) => {
                        setModel(event.target.value);
                        setSaved(false);
                      }}
                      value={model}
                      variant="surface"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-icon">
                <KeyRound size={18} strokeWidth={1.6} />
              </div>
              <div className="settings-card-body">
                <strong>Credential</strong>
                <label className="field-label">
                  <span>API key</span>
                  <TextField.Root
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setSaved(false);
                    }}
                    placeholder="Not set"
                    type="password"
                    value={apiKey}
                    variant="surface"
                  />
                </label>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="runtime">
            <div className="settings-title-row">
              <div>
                <span className="eyebrow">Settings</span>
                <h2>Runtime</h2>
              </div>
            </div>
            <div className="settings-card settings-card-toggle">
              <div>
                <strong>Git worktrees</strong>
                <span className="setting-value">
                  {worktrees ? "Enabled" : "Disabled"}
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
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </section>
  );
}
