import { Select, TextField } from "@radix-ui/themes";
import { changeModelProvider } from "@/lib/models";
import type {
  ModelConfiguration,
  ProviderKind,
} from "@/types/workflow";

interface ModelConfigurationFieldsProps {
  allowDefault?: boolean;
  className?: string;
  model: ModelConfiguration;
  onChange: (model: ModelConfiguration) => void;
}

const providerLabels: Record<ProviderKind, string> = {
  default: "Default",
  demo: "Local demo",
  openai: "OpenAI",
  openai_compatible: "OpenAI compatible",
  anthropic: "Anthropic",
};

export function ModelConfigurationFields({
  allowDefault = true,
  className,
  model,
  onChange,
}: ModelConfigurationFieldsProps) {
  const providers = Object.entries(providerLabels).filter(
    ([provider]) => allowDefault || provider !== "default",
  );
  return (
    <div className={["model-configuration-fields", className]
      .filter(Boolean)
      .join(" ")}
    >
      <label className="field-label">
        <span>Provider</span>
        <Select.Root
          onValueChange={(provider: ProviderKind) =>
            onChange(changeModelProvider(model, provider))
          }
          value={model.provider}
        >
          <Select.Trigger className="field-select" />
          <Select.Content>
            {providers.map(([provider, label]) => (
              <Select.Item key={provider} value={provider}>
                {label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </label>

      {model.provider !== "default" ? (
        <label className="field-label">
          <span>Model</span>
          <TextField.Root
            onChange={(event) =>
              onChange({ ...model, model: event.target.value })
            }
            value={model.model}
            variant="surface"
          />
        </label>
      ) : null}

      {model.provider === "openai" ? (
        <label className="field-label">
          <span>API</span>
          <Select.Root
            onValueChange={(api_mode: "responses" | "chat") =>
              onChange({ ...model, api_mode })
            }
            value={model.api_mode}
          >
            <Select.Trigger className="field-select" />
            <Select.Content>
              <Select.Item value="responses">Responses</Select.Item>
              <Select.Item value="chat">Chat</Select.Item>
            </Select.Content>
          </Select.Root>
        </label>
      ) : null}

      {model.provider === "openai_compatible" ? (
        <label className="field-label model-base-url-field">
          <span>Base URL</span>
          <TextField.Root
            onChange={(event) =>
              onChange({
                ...model,
                base_url: event.target.value || undefined,
              })
            }
            placeholder="http://localhost:11434/v1"
            value={model.base_url ?? ""}
            variant="surface"
          />
        </label>
      ) : null}
    </div>
  );
}
