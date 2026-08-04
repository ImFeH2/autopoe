import { CircleAlert, FolderOpen, LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { RuntimeState } from "@/lib/runtime";

interface ProjectEmptyStateProps {
  connection: RuntimeState["connection"];
  error: string | null;
  opening: boolean;
  onOpen: () => void;
}

export function ProjectEmptyState({
  connection,
  error,
  opening,
  onOpen,
}: ProjectEmptyStateProps) {
  const disabled = connection !== "ready" || opening;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>Open a project</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled={disabled} onClick={onOpen}>
            {connection === "connecting" || opening ? (
              <LoaderCircle className="animate-spin" />
            ) : null}
            {connection === "connecting"
              ? "Connecting"
              : opening
                ? "Opening"
                : "Open"}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>
                {connection === "error"
                  ? "Runtime unavailable"
                  : "Could not open project"}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  );
}
