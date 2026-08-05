import { Archive, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ChatInfo, closeChat, createChat, updateChat } from "@/lib/chats";
import type { AgentInfo } from "@/lib/runtime";

interface ChatDialogProps {
  agents: AgentInfo[];
  chat: ChatInfo | null;
  onClosed: (chatId: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: (chat: ChatInfo) => void;
  open: boolean;
}

interface ChatEditorProps extends ChatDialogProps {
  onOpenChange: (open: boolean) => void;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ChatEditor({
  agents,
  chat,
  onClosed,
  onOpenChange,
  onSaved,
}: ChatEditorProps) {
  const leader = agents.find((agent) => agent.kind === "leader");
  const [title, setTitle] = useState(chat?.title ?? "");
  const [purpose, setPurpose] = useState(chat?.purpose ?? "");
  const [members, setMembers] = useState<string[]>(
    chat?.members ?? (leader ? [leader.id] : []),
  );
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || closing;
  const valid = Boolean(title.trim() && members.length);

  const toggleMember = (agentId: string, checked: boolean) => {
    setMembers((current) =>
      checked
        ? current.includes(agentId)
          ? current
          : [...current, agentId]
        : current.filter((id) => id !== agentId),
    );
  };

  const save = async () => {
    if (!valid || busy) {
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      title: title.trim(),
      purpose: purpose.trim(),
      members,
    };
    try {
      const saved = chat
        ? await updateChat(chat.id, input)
        : await createChat(input);
      onSaved(saved);
      onOpenChange(false);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (!chat || busy) {
      return;
    }
    setClosing(true);
    setError(null);
    try {
      await closeChat(chat.id);
      onClosed(chat.id);
      onOpenChange(false);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setClosing(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{chat ? "Edit chat" : "New chat"}</DialogTitle>
        <DialogDescription className="sr-only">
          Manage Chat details and members.
        </DialogDescription>
      </DialogHeader>

      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="chat-title">Title</FieldLabel>
          <Input
            disabled={busy}
            id="chat-title"
            maxLength={80}
            onChange={(event) => setTitle(event.currentTarget.value)}
            value={title}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="chat-purpose">Purpose</FieldLabel>
          <Textarea
            disabled={busy}
            id="chat-purpose"
            maxLength={500}
            onChange={(event) => setPurpose(event.currentTarget.value)}
            rows={2}
            value={purpose}
          />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Members</FieldLegend>
          <div className="grid gap-2">
            {agents.map((agent) => {
              return (
                <Label
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                  htmlFor={`chat-member-${agent.id}`}
                  key={agent.id}
                >
                  <Checkbox
                    checked={members.includes(agent.id)}
                    disabled={busy}
                    id={`chat-member-${agent.id}`}
                    onCheckedChange={(checked) =>
                      toggleMember(agent.id, checked === true)
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{agent.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {agent.role}
                    </span>
                  </span>
                </Label>
              );
            })}
          </div>
        </FieldSet>
      </FieldGroup>

      <DialogFooter>
        {chat ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={busy} variant="outline">
                <Archive />
                Close
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close chat?</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={close} variant="destructive">
                  Close
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        <Button disabled={!valid || busy} onClick={save}>
          {saving ? <LoaderCircle className="animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function ChatDialog(props: ChatDialogProps) {
  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      {props.open ? (
        <ChatEditor key={props.chat?.id ?? "new"} {...props} />
      ) : null}
    </Dialog>
  );
}
