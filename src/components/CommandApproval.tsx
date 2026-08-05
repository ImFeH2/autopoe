import { LoaderCircle, Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CommandApproval as CommandApprovalState } from "@/lib/runtime";

interface CommandApprovalProps {
  approval: CommandApprovalState;
  onRespond: (approved: boolean) => void;
  responding: boolean;
}

export function CommandApproval({
  approval,
  onRespond,
  responding,
}: CommandApprovalProps) {
  return (
    <div
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 sm:right-6 sm:left-auto sm:w-full sm:max-w-3xl"
    >
      <Card className="shadow-xl" size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal />
            Run command
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            {approval.input.space}:{approval.input.path ?? "."}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <Badge variant="secondary">Host access</Badge>
            {responding ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs leading-5">
            {approval.input.command}
          </pre>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            disabled={responding}
            onClick={() => onRespond(false)}
            variant="outline"
          >
            Deny
          </Button>
          <Button disabled={responding} onClick={() => onRespond(true)}>
            Run
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
