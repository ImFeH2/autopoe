import { Archive, CircleAlert, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";

import { SettingsHeader, type SettingsPage } from "@/components/SettingsHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarInset } from "@/components/ui/sidebar";
import { archiveWorker, createWorker, updateWorker } from "@/lib/agents";
import type { AgentInfo, ProjectInfo } from "@/lib/runtime";

interface AgentForm {
  id: string | null;
  name: string;
  role: string;
}

interface AgentsPageProps {
  agents: AgentInfo[];
  onNavigate: (page: SettingsPage) => void;
  project: ProjectInfo | null;
}

function newWorker(): AgentForm {
  return { id: null, name: "", role: "" };
}

function editAgent(agent: AgentInfo): AgentForm {
  return { id: agent.id, name: agent.name, role: agent.role };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function AgentsPage({ agents, onNavigate, project }: AgentsPageProps) {
  const [form, setForm] = useState<AgentForm>(() =>
    agents[0] ? editAgent(agents[0]) : newWorker(),
  );
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = form.id ? agents.find((agent) => agent.id === form.id) : null;
  const leader = saved?.kind === "leader";
  const busy = saving || archiving;
  const valid = Boolean(project && form.name.trim() && form.role.trim());
  const dirty = saved
    ? saved.name !== form.name.trim() || saved.role !== form.role.trim()
    : true;

  const select = (agent: AgentInfo) => {
    setForm(editAgent(agent));
    setError(null);
  };

  const create = () => {
    setForm(newWorker());
    setError(null);
  };

  const save = async () => {
    if (!valid || !dirty || leader || busy) {
      return;
    }
    setSaving(true);
    setError(null);
    const input = { name: form.name.trim(), role: form.role.trim() };
    try {
      const agent = form.id
        ? await updateWorker(form.id, input)
        : await createWorker(input);
      setForm(editAgent(agent));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!form.id || leader || busy) {
      return;
    }
    setArchiving(true);
    setError(null);
    try {
      await archiveWorker(form.id);
      const projectLeader = agents.find((agent) => agent.kind === "leader");
      setForm(projectLeader ? editAgent(projectLeader) : newWorker());
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <SidebarInset className="h-svh overflow-hidden">
      <SettingsHeader activePage="agents" onNavigate={onNavigate} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid w-full max-w-5xl gap-4 p-6 md:grid-cols-[15rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Agents</CardTitle>
              <CardAction>
                <Button
                  aria-label="New worker"
                  disabled={!project || busy}
                  onClick={create}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Plus />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {agents.length ? (
                <div className="grid gap-1">
                  {agents.map((agent) => (
                    <Button
                      className="h-auto justify-between px-2 py-2 text-left"
                      disabled={busy}
                      key={agent.id}
                      onClick={() => select(agent)}
                      variant={agent.id === form.id ? "secondary" : "ghost"}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{agent.name}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {agent.role}
                        </span>
                      </span>
                      <Badge variant="secondary">
                        {agent.kind === "leader" ? "Leader" : agent.status}
                      </Badge>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">No agents</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle>
                {form.id ? form.name || "Agent" : "New worker"}
              </CardTitle>
              <CardAction className="flex gap-2">
                {form.id && !leader ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button disabled={busy} variant="outline">
                        <Archive />
                        Archive
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive worker?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {form.name}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={archive}
                          variant="destructive"
                        >
                          Archive
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
                <Button
                  disabled={!valid || !dirty || leader || busy}
                  onClick={save}
                >
                  {saving ? <LoaderCircle className="animate-spin" /> : null}
                  Save
                </Button>
              </CardAction>
            </CardHeader>

            <CardContent className="grid gap-5">
              {error ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="agent-name">Name</FieldLabel>
                  <Input
                    disabled={!project || leader || busy}
                    id="agent-name"
                    maxLength={80}
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      setForm((current) => ({ ...current, name }));
                    }}
                    value={form.name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="agent-role">Role</FieldLabel>
                  <Input
                    disabled={!project || leader || busy}
                    id="agent-role"
                    maxLength={160}
                    onChange={(event) => {
                      const role = event.currentTarget.value;
                      setForm((current) => ({ ...current, role }));
                    }}
                    value={form.role}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SidebarInset>
  );
}
