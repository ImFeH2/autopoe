import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentsPage } from "@/components/AgentsPage";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatMessages } from "@/components/ChatMessages";
import { CommandApproval } from "@/components/CommandApproval";
import { ContextInspector } from "@/components/ContextInspector";
import { ModelPage } from "@/components/ModelPage";
import { ProjectEmptyState } from "@/components/ProjectEmptyState";
import { ProvidersPage } from "@/components/ProvidersPage";
import type { SettingsPage } from "@/components/SettingsHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { send, subscribe } from "@/lib/agent";
import {
  approvalResponse,
  chatMessage,
  connectionError,
  initialRuntimeState,
  projectOpenRequest,
  reduceRuntimeMessage,
  runtimeError,
  stateRequest,
} from "@/lib/runtime";

let nextRequestId = 1;

function App() {
  const [runtime, setRuntime] = useState(initialRuntimeState);
  const [page, setPage] = useState<"chat" | SettingsPage>("chat");
  const [draft, setDraft] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectedAgentId, setInspectedAgentId] = useState<string | null>(null);
  const [openingProject, setOpeningProject] = useState(false);
  const [sending, setSending] = useState(false);
  const [respondingApprovalId, setRespondingApprovalId] = useState<
    string | null
  >(null);
  const endRef = useRef<HTMLDivElement>(null);
  const projectRequestRef = useRef<string | null>(null);
  const lastMessage = runtime.messages[runtime.messages.length - 1];
  const inspectedAgent =
    runtime.agents.find((agent) => agent.id === inspectedAgentId) ??
    runtime.agent;

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const requestId = `state-${nextRequestId++}`;

    const connect = async () => {
      const stop = await subscribe((message) => {
        if (active) {
          setRuntime((state) => reduceRuntimeMessage(state, message));
          if ("id" in message && message.id === projectRequestRef.current) {
            projectRequestRef.current = null;
            setOpeningProject(false);
          }
        }
      });
      if (!active) {
        stop();
        return;
      }
      unsubscribe = stop;
      await send(stateRequest(requestId));
    };

    connect().catch((error) => {
      if (active) {
        setRuntime((state) => connectionError(state, error));
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (lastMessage) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [lastMessage]);

  useEffect(() => {
    if (runtime.turn || runtime.connection === "error") {
      setSending(false);
    }
  }, [runtime.connection, runtime.turn]);

  const busy =
    sending ||
    runtime.agent?.status === "running" ||
    runtime.agent?.status === "waiting";
  const canSend =
    runtime.connection === "ready" &&
    Boolean(runtime.agent?.model) &&
    !busy &&
    draft.trim().length > 0;

  const submit = async () => {
    const content = draft.trim();
    if (!content || !canSend) {
      return;
    }

    setDraft("");
    setSending(true);
    try {
      await send(chatMessage(content));
    } catch (error) {
      setDraft(content);
      setSending(false);
      setRuntime((state) => connectionError(state, error));
    }
  };

  const inspectAgent = (agentId = runtime.agent?.id) => {
    if (!agentId) {
      return;
    }
    setInspectedAgentId(agentId);
    setInspectorOpen(true);
  };

  const respondToApproval = async (approved: boolean) => {
    const approval = runtime.approval;
    if (!approval || respondingApprovalId === approval.id) {
      return;
    }
    setRespondingApprovalId(approval.id);
    try {
      await send(approvalResponse(approval.id, approved));
    } catch (error) {
      setRespondingApprovalId(null);
      setRuntime((state) => runtimeError(state, error));
    }
  };

  const changePage = (nextPage: "chat" | SettingsPage) => {
    setPage(nextPage);
    if (nextPage !== "chat") {
      setInspectorOpen(false);
    }
  };

  const openProject = async () => {
    try {
      const workspace = await open({
        directory: true,
        multiple: false,
        title: "Open project",
      });
      if (!workspace) {
        return;
      }

      const requestId = `project-${nextRequestId++}`;
      projectRequestRef.current = requestId;
      setOpeningProject(true);
      setRuntime((state) => ({ ...state, error: null }));
      await send(projectOpenRequest(requestId, workspace));
    } catch (error) {
      projectRequestRef.current = null;
      setOpeningProject(false);
      setRuntime((state) => runtimeError(state, error));
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar
        activePage={page}
        agents={runtime.agents}
        chat={runtime.chat}
        connection={runtime.connection}
        onInspect={inspectAgent}
        onPageChange={changePage}
        project={runtime.project}
      />

      {page === "agents" ? (
        <AgentsPage
          agents={runtime.agents}
          onNavigate={changePage}
          project={runtime.project}
        />
      ) : page === "model" ? (
        <ModelPage onNavigate={changePage} />
      ) : page === "providers" ? (
        <ProvidersPage onNavigate={changePage} />
      ) : runtime.project ? (
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator className="h-4" orientation="vertical" />
            <MessageSquare className="size-4" />
            <span className="text-sm font-medium">
              {runtime.chat?.title ?? "General"}
            </span>

            <div className="ml-auto">
              {runtime.agent ? (
                <Button
                  aria-label={`Inspect ${runtime.agent.name}`}
                  onClick={() => inspectAgent(runtime.agent?.id)}
                  size="sm"
                  variant="ghost"
                >
                  <Avatar size="sm">
                    <AvatarImage alt="" src="/flowent.png" />
                    <AvatarFallback>L</AvatarFallback>
                  </Avatar>
                  <span>{runtime.agent.name}</span>
                  <Badge variant="secondary">
                    {runtime.agent.model ? runtime.agent.status : "No model"}
                  </Badge>
                </Button>
              ) : (
                <Badge
                  variant={
                    runtime.connection === "error" ? "destructive" : "secondary"
                  }
                >
                  {runtime.connection === "error"
                    ? "Unavailable"
                    : "Connecting"}
                </Badge>
              )}
            </div>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <ChatMessages
              agent={runtime.agent}
              connection={runtime.connection}
              error={runtime.error}
              messages={runtime.messages}
              onInspect={() => inspectAgent(runtime.agent?.id)}
            />
            <div ref={endRef} />
          </ScrollArea>

          <ChatComposer
            canSend={canSend}
            disabled={
              runtime.connection !== "ready" || !runtime.agent?.model || busy
            }
            onChange={setDraft}
            onSend={submit}
            value={draft}
          />
        </SidebarInset>
      ) : (
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator className="h-4" orientation="vertical" />
            <FolderOpen className="size-4" />
            <span className="text-sm font-medium">Project</span>
          </header>
          <ProjectEmptyState
            connection={runtime.connection}
            error={runtime.error}
            onOpen={openProject}
            opening={openingProject}
          />
        </SidebarInset>
      )}

      {inspectedAgent ? (
        <ContextInspector
          agent={inspectedAgent}
          onOpenChange={setInspectorOpen}
          open={inspectorOpen}
          turn={inspectedAgent.id === runtime.agent?.id ? runtime.turn : null}
        />
      ) : null}

      {runtime.approval ? (
        <CommandApproval
          approval={runtime.approval}
          onRespond={respondToApproval}
          responding={respondingApprovalId === runtime.approval.id}
        />
      ) : null}
    </SidebarProvider>
  );
}

export default App;
