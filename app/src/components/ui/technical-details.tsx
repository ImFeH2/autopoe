import { useState } from "react";
import { Button } from "./button";

export type TechnicalIdentifier = {
  label: string;
  value: number | string;
};

type ClipboardWriter = {
  writeText: (value: string) => Promise<void>;
};

export async function copyTechnicalId(
  value: number | string,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
) {
  if (!clipboard) {
    throw new Error("Clipboard is unavailable");
  }
  await clipboard.writeText(String(value));
}

export function TechnicalDetails({
  identifiers,
  label = "Technical details",
}: {
  identifiers: readonly TechnicalIdentifier[];
  label?: string;
}) {
  const [status, setStatus] = useState("");

  if (identifiers.length === 0) {
    return null;
  }

  return (
    <details className="ui-technical-details">
      <summary>{label}</summary>
      <dl className="ui-technical-details__list">
        {identifiers.map((identifier) => {
          const value = String(identifier.value);
          return (
            <div
              className="ui-technical-details__row"
              key={`${identifier.label}-${value}`}
            >
              <dt>{identifier.label}</dt>
              <dd>
                <code>{value}</code>
                <Button
                  aria-label={`Copy ${identifier.label} ID`}
                  onClick={async () => {
                    try {
                      await copyTechnicalId(value);
                      setStatus(`Copied ${identifier.label} ID`);
                    } catch {
                      setStatus("Copy unavailable");
                    }
                  }}
                  size="compact"
                  variant="quiet"
                >
                  Copy ID
                </Button>
              </dd>
            </div>
          );
        })}
      </dl>
      <p aria-live="polite" className="ui-technical-details__status">
        {status}
      </p>
    </details>
  );
}
