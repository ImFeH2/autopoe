import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, MessageSquare, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentsPage } from "@/components/AgentsPage";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatDialog } from "@/components/ChatDialog";
import { ChatMessages } from "@/components/ChatMessages";
import { CommandApproval } from "@/components/CommandApproval";
import { ContextInspector } from "@/components/ContextInspector";
import { ModelPage } from "@/components/ModelPage";
import { ProjectEmptyState } from "@/components/ProjectEmptyState";
import { ProvidersPage } from "@/components/ProvidersPage";
import type { SettingsPage } from "@/components/SettingsHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { send, subscribe } from "@/lib/agent";
import {
  type ChatInfo,
  listChatMessages,
  sendChatMessage as postChatMessage,
} from "@/lib/chats";
import {
  addChatMessage,
  approvalResponse,
  chatMessage,
  connectionError,
  initialRuntimeState,
  projectOpenRequest,
  reduceRuntimeMessage,
  replaceChatMessages,
  runtimeError,
  stateRequest,
} from "@/lib/runtime";

let nextRequestId = 1;

function App() {
  const [runtime, setRuntime] = useState(initialRuntimeState);
  const [page, setPage] = useState<"chat" | SettingsPage>("chat");
  const [draft, setDraft] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectedAgentId, setInspectedAgentId] = useState<string | null>(null);
  const [openingProject, setOpeningProject] = useState(false);
  const [sending, setSending] = useState(false);
  const [respondingApprovalId, setRespondingApprovalId] = useState<
    string | null
  >(null);
  const endRef = useRef<HTMLDivElement>(null);
  const projectRequestRef = useRef<string | null>(null);
  const generalChat =
    runtime.chats.find((chat) => chat.kind === "general") ?? runtime.chat;
  const selectedChat =
    runtime.chats.find((chat) => chat.id === selectedChatId) ?? generalChat;
  const messages = selectedChat
    ? (runtime.messagesByChat[selectedChat.id] ?? [])
    : [];
  const lastMessage = messages[messages.length - 1];
  const editingChat = editingChatId
    ? (runtime.chats.find((chat) => chat.id === editingChatId) ?? null)
    : null;
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

  const leaderBusy =
    runtime.agent?.status === "running" || runtime.agent?.status === "waiting";
  const busy = sending || (selectedChat?.kind === "general" && leaderBusy);
  const canSend =
    runtime.connection === "ready" &&
    Boolean(selectedChat) &&
    (selectedChat?.kind !== "general" || Boolean(runtime.agent?.model)) &&
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
      if (selectedChat?.kind === "general") {
        await send(chatMessage(content));
      } else if (selectedChat) {
        const message = await postChatMessage(selectedChat.id, content);
        setRuntime((state) => addChatMessage(state, message));
        setSending(false);
      }
    } catch (error) {
      setDraft(content);
      setSending(false);
      setRuntime((state) => connectionError(state, error));
    }
  };

  const selectChat = async (chatId: string) => {
    setSelectedChatId(chatId);
    setPage("chat");
    setInspectorOpen(false);
    setDraft("");
    if (runtime.chats.find((chat) => chat.id === chatId)?.kind === "general") {
      return;
    }
    try {
      const loaded = await listChatMessages(chatId);
      setRuntime((state) => replaceChatMessages(state, chatId, loaded));
    } catch (error) {
      setRuntime((state) => runtimeError(state, error));
    }
  };

  const newChat = () => {
    setEditingChatId(null);
    setChatDialogOpen(true);
  };

  const editChat = (chat: ChatInfo) => {
    setEditingChatId(chat.id);
    setChatDialogOpen(true);
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
        activeChatId={selectedChat?.id ?? null}
        agents={runtime.agents}
        chats={runtime.chats}
        connection={runtime.connection}
        onInspect={inspectAgent}
        onNewChat={newChat}
        onPageChange={changePage}
        onSelectChat={selectChat}
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
      ) : runtime.project && selectedChat ? (
        <SidebarInset className="h-svh overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <Separator className="h-4" orientation="vertical" />
            <MessageSquare className="size-4" />
            <span className="text-sm font-medium">{selectedChat.title}</span>

            <div className="ml-auto flex items-center gap-2">
              <Badge variant="secondary">
                {selectedChat.members.length}{" "}
                {selectedChat.members.length === 1 ? "member" : "members"}
              </Badge>
              {selectedChat.kind === "general" && runtime.agent ? (
                <Badge variant="secondary">
                  {runtime.agent.model ? runtime.agent.status : "No model"}
                </Badge>
              ) : null}
              {selectedChat.kind === "custom" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Edit chat"
                      onClick={() => editChat(selectedChat)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit chat</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <ChatMessages
              agents={runtime.agents}
              chat={selectedChat}
              error={runtime.error}
              messages={messages}
              onInspect={inspectAgent}
            />
            <div ref={endRef} />
          </ScrollArea>

          <ChatComposer
            canSend={canSend}
            disabled={
              runtime.connection !== "ready" ||
              (selectedChat.kind === "general" && !runtime.agent?.model) ||
              busy
            }
            label={`Message ${selectedChat.title}`}
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

      <ChatDialog
        agents={runtime.agents}
        chat={editingChat}
        onClosed={() => {
          setSelectedChatId(null);
          setDraft("");
        }}
        onOpenChange={setChatDialogOpen}
        onSaved={(chat) => {
          void selectChat(chat.id);
        }}
        open={chatDialogOpen}
      />
    </SidebarProvider>
  );
}

export default App;
