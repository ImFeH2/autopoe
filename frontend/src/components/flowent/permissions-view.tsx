import { useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  dashedPanelClassName,
  emptyStateClassName,
  fieldInputClassName,
  fieldLabelClassName,
  mutedTextClassName,
  sectionTitleClassName,
  stableScrollbarClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import { useFlowentToast } from "@/components/flowent/toast-context";
import type { WritablePath } from "@/features/permissions/model/permission-types";
import i18n from "@/i18n/i18n";
import { cn } from "@/lib/utils";

export function PermissionsView({
  onAddWritablePath,
  onRemoveWritablePath,
  writablePaths,
}: {
  onAddWritablePath: (path: string) => Promise<void>;
  onRemoveWritablePath: (path: string) => void;
  writablePaths: WritablePath[];
}) {
  const { t } = useTranslation();
  const toast = useFlowentToast();
  const [directoryPath, setDirectoryPath] = useState("");
  const [addError, setAddError] = useState("");
  const trimmedDirectoryPath = directoryPath.trim();

  const addWritablePath = async () => {
    if (!trimmedDirectoryPath) {
      return;
    }

    if (
      writablePaths.some(
        (writablePath) => writablePath.path === trimmedDirectoryPath,
      )
    ) {
      setAddError(t("setup.permissions.errors.duplicate"));
      return;
    }

    try {
      await onAddWritablePath(trimmedDirectoryPath);
      setDirectoryPath("");
      setAddError("");
    } catch {
      toast.error(i18n.t("setup.permissions.errors.add"));
    }
  };

  return (
    <section
      aria-label={t("setup.permissions.page")}
      className={cn(
        "grid h-full min-h-0 content-start gap-7 overflow-auto bg-black px-12 py-8 max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
    >
      <section className="grid max-w-4xl gap-3">
        <h3 className={sectionTitleClassName}>
          {t("setup.permissions.writablePaths")}
        </h3>
        <form
          aria-label={t("setup.permissions.addDirectory")}
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void addWritablePath();
          }}
        >
          <label className={fieldLabelClassName} htmlFor="writable-path-input">
            {t("setup.permissions.directoryPath")}
          </label>
          <div className="flex gap-2 max-[640px]:flex-col">
            <Input
              aria-invalid={addError ? true : undefined}
              className={cn(fieldInputClassName, "flex-1")}
              id="writable-path-input"
              onChange={(event) => {
                setDirectoryPath(event.target.value);
                setAddError("");
              }}
              placeholder={t("setup.permissions.pathPlaceholder")}
              type="text"
              value={directoryPath}
            />
            <Button
              className={cn(subtleButtonClassName, "shrink-0")}
              disabled={!trimmedDirectoryPath}
              size="sm"
              type="submit"
              variant="outline"
            >
              <Plus aria-hidden="true" />
              {t("setup.permissions.add")}
            </Button>
          </div>
          {addError ? (
            <p className="m-0 text-xs leading-[1.4] text-destructive">
              {addError}
            </p>
          ) : null}
        </form>
        {writablePaths.length === 0 ? (
          <p className={emptyStateClassName}>
            {t("setup.permissions.noPaths")}
          </p>
        ) : (
          <div className={dashedPanelClassName}>
            {writablePaths.map((writablePath) => (
              <WritablePathRow
                key={writablePath.path}
                onRemoveWritablePath={onRemoveWritablePath}
                writablePath={writablePath}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function WritablePathRow({
  onRemoveWritablePath,
  writablePath,
}: {
  onRemoveWritablePath: (path: string) => void;
  writablePath: WritablePath;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-3 last:border-b-0 max-[640px]:grid-cols-1">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-white/60"
        />
        <div className="min-w-0">
          <p className="m-0 truncate font-mono text-base leading-5 text-white">
            {writablePath.path}
          </p>
          <p className={cn("m-0 text-xs leading-[1.4]", mutedTextClassName)}>
            {t("setup.permissions.alwaysAllowed")}
          </p>
        </div>
      </div>
      <Button
        className={cn(subtleButtonClassName, "shrink-0")}
        onClick={() => onRemoveWritablePath(writablePath.path)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Trash2 aria-hidden="true" />
        {t("setup.permissions.remove")}
      </Button>
    </div>
  );
}
