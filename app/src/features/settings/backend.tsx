import { useCallback, useEffect, useState } from "react";
import { Page, PageBody, PageHeader } from "../../components/layout/shell";
import { Choices } from "../../components/ui/choices";
import { Banner, Button, Chip } from "../../components/ui/index";
import {
  appBackend,
  type BackendStatus,
  type BackendTarget,
} from "../../lib/app-backend";
import "./settings.css";

export function targetValue(target: BackendTarget | null): string {
  return target
    ? target.kind === "native"
      ? "native"
      : `wsl:${target.distribution}`
    : "";
}

export function targetFromValue(value: string): BackendTarget {
  if (value === "native") return { kind: "native" };
  if (value.startsWith("wsl:") && value.slice(4).trim()) {
    return { kind: "wsl", distribution: value.slice(4) };
  }
  throw new Error("Choose a backend");
}

export function BackendPage({ startupError }: { startupError?: string }) {
  const [info, setInfo] = useState<BackendStatus | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await appBackend.status();
      setInfo(status);
      setSelected(targetValue(status.configured));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!info || busy || !selected) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setInfo(await appBackend.save(targetFromValue(selected)));
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const problem = error || info?.error || startupError;
  const active = info?.active;
  return (
    <Page>
      <PageHeader title="Backend" />
      <PageBody>
        {problem ? <Banner tone="danger">{problem}</Banner> : null}
        {info?.probe_error ? (
          <Banner tone="warning">{info.probe_error}</Banner>
        ) : null}
        {saved ? <Banner tone="success">Saved</Banner> : null}
        {!info && error ? (
          <Button disabled={busy} onClick={load}>
            Retry
          </Button>
        ) : null}
        <span>
          Current:{" "}
          {active
            ? active.kind === "native"
              ? "Native"
              : `WSL · ${active.distribution}`
            : "Unavailable"}
        </span>
        <fieldset className="settings-form" disabled={!info || busy}>
          <legend>Next start</legend>
          <Choices
            label="Backend"
            value={selected}
            disabled={!info || busy}
            options={[
              { value: "native", label: "Native" },
              ...(info?.distributions ?? []).map((name) => ({
                value: `wsl:${name}`,
                label: `WSL · ${name}`,
              })),
            ]}
            onChange={(value) => {
              setSelected(value);
              setSaved(false);
            }}
          />
          <div className="settings-actions">
            <Button
              variant="primary"
              disabled={
                !selected || selected === targetValue(info?.configured ?? null)
              }
              onClick={save}
            >
              Save
            </Button>
            {info?.restart_required ? (
              <Chip tone="warning">Restart required</Chip>
            ) : null}
          </div>
        </fieldset>
      </PageBody>
    </Page>
  );
}
