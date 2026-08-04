import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatMessages } from "@/components/ChatMessages";
import { ContextInspector } from "@/components/ContextInspector";
import { ProjectEmptyState } from "@/components/ProjectEmptyState";
import { ProvidersPage } from "@/components/ProvidersPage";
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
  const [page, setPage] = useState<"chat" | "providers">("chat");
  const [draft, setDraft] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [openingProject, setOpeningProject] = useState(false);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const projectRequestRef = useRef<string | null>(null);
  const lastMessage = runtime.messages[runtime.messages.length - 1];

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

  const busy = sending || runtime.agent?.status === "running";
  const canSend =
    runtime.connection === "ready" && !busy && draft.trim().length > 0;

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

  const inspectAgent = () => setInspectorOpen(true);

  const changePage = (nextPage: "chat" | "providers") => {
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
        agent={runtime.agent}
        connection={runtime.connection}
        onInspect={inspectAgent}
        onPageChange={changePage}
        project={runtime.project}
      />

      {page === "providers" ? (
        <ProvidersPage />
      ) : runtime.project ? (
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator className="h-4" orientation="vertical" />
            <MessageSquare className="size-4" />
            <span className="text-sm font-medium">General</span>

            <div className="ml-auto">
              {runtime.agent ? (
                <Button
                  aria-label={`Inspect ${runtime.agent.name}`}
                  onClick={inspectAgent}
                  size="sm"
                  variant="ghost"
                >
                  <Avatar size="sm">
                    <AvatarImage alt="" src="/flowent.png" />
                    <AvatarFallback>L</AvatarFallback>
                  </Avatar>
                  <span>{runtime.agent.name}</span>
                  <Badge variant="secondary">{runtime.agent.status}</Badge>
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
              onInspect={inspectAgent}
            />
            <div ref={endRef} />
          </ScrollArea>

          <ChatComposer
            canSend={canSend}
            disabled={runtime.connection !== "ready" || busy}
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

      {page === "chat" && runtime.agent ? (
        <ContextInspector
          agent={runtime.agent}
          onOpenChange={setInspectorOpen}
          open={inspectorOpen}
          turn={runtime.turn}
        />
      ) : null}
    </SidebarProvider>
  );
}

export default App;
