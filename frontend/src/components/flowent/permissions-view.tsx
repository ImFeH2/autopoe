import { ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  dashedPanelClassName,
  emptyStateClassName,
  mutedTextClassName,
  sectionTitleClassName,
  stableScrollbarClassName,
  subtleButtonClassName,
} from "@/components/flowent/styles";
import type { WritablePath } from "@/components/flowent/types";
import { cn } from "@/lib/utils";

export function PermissionsView({
  onRemoveWritablePath,
  writablePaths,
}: {
  onRemoveWritablePath: (path: string) => void;
  writablePaths: WritablePath[];
}) {
  return (
    <section
      aria-label="Permissions"
      className={cn(
        "grid h-full min-h-0 content-start gap-7 overflow-auto bg-black px-12 py-8 max-[900px]:h-auto max-[900px]:min-h-[calc(100vh-126px)] max-[900px]:overflow-visible max-[900px]:px-5 max-[900px]:py-5",
        stableScrollbarClassName,
      )}
    >
      <section className="grid max-w-4xl gap-3">
        <h3 className={sectionTitleClassName}>Writable paths</h3>
        {writablePaths.length === 0 ? (
          <p className={emptyStateClassName}>No paths</p>
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
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-3 last:border-b-0 max-[640px]:grid-cols-1">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-white/60"
        />
        <div className="min-w-0">
          <p className="m-0 truncate font-mono text-[13px] leading-5 text-white">
            {writablePath.path}
          </p>
          <p className={cn("m-0 text-xs leading-[1.4]", mutedTextClassName)}>
            Always allowed
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
        Remove
      </Button>
    </div>
  );
}
