import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import {
  Page,
  PageBody,
  PageHeader,
  Section,
} from "../../components/layout/shell";
import { Banner, Button, Chip, Field, Input } from "../../components/ui/index";
import { backend } from "../../lib/backend";
import "./settings.css";

type Unusable = { path: string; reason: string };

function useSaver(load: () => Promise<void>) {
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const save = async (section: string, values: Record<string, unknown>) => {
    setStatus(null);
    try {
      await backend.updateSettings(section, values);
      setFailed(false);
      setStatus("Saved.");
      await load();
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return { status, failed, save, dismiss: () => setStatus(null) };
}

export function ModelPage() {
  const providerId = useId();
  const baseUrlId = useId();
  const modelId = useId();
  const keyId = useId();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [apiKey, setApiKey] = useState("");

  const load = useCallback(async () => {
    setValues(await backend.settings("model"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { status, failed, save, dismiss } = useSaver(load);
  const configured = values.api_key_set === true;

  return (
    <Page>
      <PageHeader
        title="Model"
        lede="Every Agent in the organization runs on this model. Changing it takes effect the next time Huddol starts."
      />
      <PageBody>
        {status ? (
          <Banner
            tone={failed ? "danger" : "success"}
            icon={failed ? <AlertTriangle size={16} /> : undefined}
            onDismiss={dismiss}
          >
            {status}
          </Banner>
        ) : null}
        <Section
          title="Provider"
          description="The endpoint and credentials Agents use to reach the model."
        >
          <div className="settings-form">
            <Field label="Provider" htmlFor={providerId}>
              <Input
                id={providerId}
                value={String(values.api_type ?? "")}
                placeholder="openai"
                onChange={(event) =>
                  setValues({ ...values, api_type: event.target.value })
                }
              />
            </Field>
            <Field label="Base URL" htmlFor={baseUrlId}>
              <Input
                id={baseUrlId}
                value={String(values.base_url ?? "")}
                placeholder="https://api.example.com/v1"
                onChange={(event) =>
                  setValues({ ...values, base_url: event.target.value })
                }
              />
            </Field>
            <Field label="Model" htmlFor={modelId}>
              <Input
                id={modelId}
                value={String(values.model ?? "")}
                onChange={(event) =>
                  setValues({ ...values, model: event.target.value })
                }
              />
            </Field>
            <Field
              label="API key"
              htmlFor={keyId}
              hint={
                configured
                  ? "A key is stored. Leave this blank to keep it."
                  : "Required before any Agent can run."
              }
            >
              <Input
                id={keyId}
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={configured ? "Unchanged" : "Required"}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </Field>
            <div className="settings-actions">
              <Button
                variant="primary"
                onClick={async () => {
                  const next: Record<string, unknown> = {
                    api_type: values.api_type,
                    base_url: values.base_url,
                    model: values.model,
                  };
                  if (apiKey.trim()) next.api_key = apiKey.trim();
                  await save("model", next);
                  setApiKey("");
                }}
              >
                Save model settings
              </Button>
              {configured ? <Chip tone="success">Key stored</Chip> : null}
            </div>
          </div>
        </Section>
      </PageBody>
    </Page>
  );
}

export function ExecutionPage() {
  const pathId = useId();
  const [directories, setDirectories] = useState<string[]>([]);
  const [unusable, setUnusable] = useState<Unusable[]>([]);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const values = await backend.settings("execution");
    setDirectories((values.write_directories as string[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return backend.onEvent((event) => {
      if (event.type !== "ready") return;
      setUnusable((event.unusable_write_directories as Unusable[]) ?? []);
    });
  }, []);

  const { status, failed, save, dismiss } = useSaver(load);

  return (
    <Page>
      <PageHeader
        title="Execution"
        lede="Agents can read anything you can read. Writing is confined to the directories listed here, enforced by the operating system rather than by the Agent's own restraint."
      />
      <PageBody>
        {status ? (
          <Banner
            tone={failed ? "danger" : "success"}
            icon={failed ? <AlertTriangle size={16} /> : undefined}
            onDismiss={dismiss}
          >
            {status}
          </Banner>
        ) : null}
        {unusable.length > 0 ? (
          <Banner tone="warning" icon={<AlertTriangle size={16} />}>
            These directories could not be used when Huddol started. They stay
            configured so you can fix or remove them.
            <ul className="unusable-list">
              {unusable.map((item) => (
                <li key={item.path}>
                  <span className="directory-path">{item.path}</span>
                  <Chip tone="warning">{item.reason}</Chip>
                </li>
              ))}
            </ul>
          </Banner>
        ) : null}
        <Section
          title="Writable directories"
          description="A change takes effect for the very next command an Agent runs."
        >
          <div className="settings-form">
            {directories.length === 0 ? (
              <p className="muted">
                None configured. Agents can read, but every write will be
                refused.
              </p>
            ) : (
              <ul className="directory-list">
                {directories.map((path) => {
                  const problem = unusable.find((item) => item.path === path);
                  return (
                    <li
                      className="directory"
                      key={path}
                      data-unusable={problem !== undefined}
                    >
                      <span className="directory-path">{path}</span>
                      {problem ? (
                        <Chip tone="warning">{problem.reason}</Chip>
                      ) : null}
                      <Button
                        variant="danger"
                        onClick={() =>
                          save("execution", {
                            write_directories: directories.filter(
                              (item) => item !== path,
                            ),
                          })
                        }
                      >
                        <Trash2 size={15} />
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Field
              label="Add a directory"
              htmlFor={pathId}
              hint="Absolute path. It may not exist yet."
            >
              <div className="add-directory">
                <Input
                  id={pathId}
                  value={draft}
                  placeholder="/home/you/work"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !draft.trim()) return;
                    void save("execution", {
                      write_directories: [...directories, draft.trim()],
                    }).then(() => setDraft(""));
                  }}
                />
                <Button
                  disabled={!draft.trim()}
                  onClick={async () => {
                    await save("execution", {
                      write_directories: [...directories, draft.trim()],
                    });
                    setDraft("");
                  }}
                >
                  <Plus size={16} />
                  Add
                </Button>
              </div>
            </Field>
          </div>
        </Section>
      </PageBody>
    </Page>
  );
}

export function LimitsPage() {
  const limitId = useId();
  const [limit, setLimit] = useState("0");

  const load = useCallback(async () => {
    const values = await backend.settings("limits");
    setLimit(String(values.agent_token_limit ?? 0));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { status, failed, save, dismiss } = useSaver(load);
  const parsed = Number(limit) || 0;

  return (
    <Page>
      <PageHeader
        title="Limits"
        lede="A ceiling on what a single Agent may spend in total. It is per Agent, not shared across the organization."
      />
      <PageBody>
        {status ? (
          <Banner
            tone={failed ? "danger" : "success"}
            icon={failed ? <AlertTriangle size={16} /> : undefined}
            onDismiss={dismiss}
          >
            {status}
          </Banner>
        ) : null}
        <Section
          title="Cumulative token limit"
          description="An Agent that reaches its ceiling stops being scheduled. Its state does not change and nothing is reported as an error, because a spent budget is not a fault. Raise the limit and it becomes schedulable again immediately."
        >
          <div className="settings-form">
            <Field
              label="Tokens per Agent"
              htmlFor={limitId}
              hint="0 means no ceiling."
            >
              <Input
                id={limitId}
                inputMode="numeric"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </Field>
            <div className="settings-actions">
              <Button
                variant="primary"
                onClick={() => save("limits", { agent_token_limit: parsed })}
              >
                Save limit
              </Button>
              <Chip tone={parsed > 0 ? "neutral" : "warning"}>
                {parsed > 0
                  ? `${parsed.toLocaleString()} tokens`
                  : "No ceiling"}
              </Chip>
            </div>
          </div>
        </Section>
      </PageBody>
    </Page>
  );
}
