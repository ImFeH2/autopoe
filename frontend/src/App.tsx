import "@/styles/App.css";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  LoaderCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import { Toaster } from "sonner";
import { SecretInput } from "@/components/form/FormControls";
import { ImageViewerProvider } from "@/components/ImageViewer";
import { Sidebar } from "@/components/Sidebar";
import {
  ShellBackground,
  ShellSurface,
} from "@/components/layout/ShellBackground";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { ShellHeader } from "@/components/layout/ShellHeader";
import { Button } from "@/components/ui/button";
import { MotionButton } from "@/components/ui/motion-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentProvider, useAgentUI, type PageId } from "@/context/AgentContext";
import { AccessProvider } from "@/context/AccessContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { useAccess } from "@/context/useAccess";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePanelWidth } from "@/hooks/usePanelDrag";

function lazyPage<TModule, TKey extends keyof TModule & string>(
  loader: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => {
    const module = await loader();
    return {
      default: module[exportName] as ComponentType,
    };
  });
}

const HomePage = lazyPage(() => import("@/pages/HomePage"), "HomePage");
const AssistantPage = lazyPage(
  () => import("@/pages/AssistantPage"),
  "AssistantPage",
);
const ProvidersPage = lazyPage(
  () => import("@/pages/ProvidersPage"),
  "ProvidersPage",
);
const McpPage = lazyPage(() => import("@/pages/McpPage"), "McpPage");
const RolesPage = lazyPage(() => import("@/pages/RolesPage"), "RolesPage");
const PromptsPage = lazyPage(
  () => import("@/pages/PromptsPage"),
  "PromptsPage",
);
const ToolsPage = lazyPage(() => import("@/pages/ToolsPage"), "ToolsPage");
const ChannelsPage = lazyPage(
  () => import("@/pages/ChannelsPage"),
  "ChannelsPage",
);
const SettingsPage = lazyPage(
  () => import("@/pages/SettingsPage"),
  "SettingsPage",
);

const lazyPageMap: Record<PageId, ComponentType> = {
  assistant: AssistantPage,
  workspace: HomePage,
  providers: ProvidersPage,
  mcp: McpPage,
  roles: RolesPage,
  prompts: PromptsPage,
  tools: ToolsPage,
  channels: ChannelsPage,
  settings: SettingsPage,
};

const shellFloatingButtonClass =
  "z-30 flex items-center justify-center border border-border bg-surface-overlay text-muted-foreground backdrop-blur-xl transition-colors hover:bg-accent/80 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const accessInputClass =
  "h-12 w-full rounded-xl border border-input bg-background/55 px-4 pr-12 font-mono text-[15px] tracking-[0.04em] text-foreground transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/70 focus:bg-background/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

const accessButtonClass =
  "group flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

function AppContent() {
  const { currentPage } = useAgentUI();
  const { logout } = useAccess();
  const isWorkspace = currentPage === "workspace";
  const isCompactLayout = useMediaQuery("(max-width: 980px)");
  const [sidebarWidth, setSidebarWidth] = usePanelWidth(
    "sidebar-width",
    232,
    196,
    320,
  );
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);

  const LazyPage = lazyPageMap[currentPage];
  const sidebarOpen = isCompactLayout && sidebarDrawerOpen;

  const renderPage = () => {
    return (
      <Suspense
        fallback={
          <PageLoadingState
            label="Loading page..."
            barClassName="skeleton-shimmer animate-none"
          />
        }
      >
        <LazyPage />
      </Suspense>
    );
  };

  const pageContent = (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentPage}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="relative h-full"
      >
        {isWorkspace ? (
          renderPage()
        ) : (
          <div className="mx-auto flex h-full w-full max-w-[1320px] min-h-0 flex-col px-4 sm:px-6 lg:px-8">
            <ShellHeader
              compact={isCompactLayout}
              onOpenNavigation={() => setSidebarDrawerOpen(true)}
            />
            <div className="min-h-0 flex-1">{renderPage()}</div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <ShellBackground variant="app">
      {isCompactLayout ? (
        <AnimatePresence>
          {sidebarOpen ? (
            <>
              <MotionButton
                type="button"
                variant="ghost"
                aria-label="Close navigation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 z-40 h-auto w-auto rounded-none border-0 bg-background/72 p-0 shadow-none backdrop-blur-[2px] hover:bg-background/72 focus-visible:ring-0"
                onClick={() => setSidebarDrawerOpen(false)}
              />
              <motion.div
                initial={{ x: -24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-y-0 left-0 z-50"
              >
                <Sidebar
                  autoHide
                  width={Math.min(sidebarWidth, 320)}
                  onWidthChange={setSidebarWidth}
                  onNavigate={() => setSidebarDrawerOpen(false)}
                />
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      ) : (
        <Sidebar width={sidebarWidth} onWidthChange={setSidebarWidth} />
      )}

      <main
        className="relative z-10 h-full isolate"
        style={
          isCompactLayout
            ? undefined
            : {
                marginLeft: `${sidebarWidth}px`,
                width: `calc(100% - ${sidebarWidth}px)`,
              }
        }
      >
        {isWorkspace ? (
          <ShellSurface
            variant="workspace"
            className={cn("h-full backdrop-blur-xl [contain:paint]")}
          >
            {isCompactLayout ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    sidebarOpen ? "Close navigation" : "Open navigation"
                  }
                  onClick={() => setSidebarDrawerOpen((current) => !current)}
                  className={cn(
                    shellFloatingButtonClass,
                    "absolute left-3.5 top-3.5 size-9 rounded-md",
                  )}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="size-4" />
                  ) : (
                    <PanelLeftOpen className="size-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Logout"
                  onClick={() => {
                    void logout();
                  }}
                  className={cn(
                    shellFloatingButtonClass,
                    "absolute right-3.5 top-3.5 h-9 gap-2 rounded-full px-3 text-[12px] font-medium",
                  )}
                >
                  <LogOut className="size-3.5" />
                  Logout
                </Button>
              </>
            ) : null}
            {pageContent}
          </ShellSurface>
        ) : (
          <div className="h-full [contain:paint]">{pageContent}</div>
        )}
      </main>
    </ShellBackground>
  );
}

function normalizeAccessError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Failed to verify access code";
  }
  return error.message.replace(/^Failed to verify access code:\s*/u, "");
}

function AccessGate() {
  const { login, state } = useAccess();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const accessUnavailable = state.requires_restart;
  const restartMessage =
    "Access was reset locally. Restart Flowent to generate a new access code.";
  const feedbackMessage = accessUnavailable ? restartMessage : error;

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (accessUnavailable) {
      return;
    }
    if (!code.trim()) {
      setError("Enter the access code");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await login(code);
      setCode("");
    } catch (loginError) {
      setError(normalizeAccessError(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ShellBackground variant="access">
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.04, ease: "easeOut" }}
          className="mb-7 flex items-center gap-2 text-[12px] font-medium tracking-[0.04em] text-muted-foreground/80"
        >
          <span
            aria-hidden="true"
            className="size-1 rounded-full bg-foreground/70 shadow-[0_0_8px_color-mix(in_srgb,var(--foreground)_30%,transparent)]"
          />
          Flowent
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.08, ease: "easeOut" }}
          className="w-full max-w-[420px]"
        >
          <ShellSurface
            variant="access"
            className="rounded-2xl border border-border/80 p-7 text-popover-foreground shadow-2xl shadow-black/40 sm:p-8"
          >
            <form
              className="relative z-10"
              onSubmit={(event) => void handleSubmit(event)}
            >
              <div className="flex flex-col items-center text-center">
                <h1 className="text-[22px] font-medium leading-tight tracking-tight text-foreground">
                  Enter Access Code
                </h1>
              </div>

              <div className="mt-6 space-y-3.5">
                <div className="space-y-2">
                  <label
                    htmlFor="access-code"
                    className="block text-[12px] font-medium text-foreground/80"
                  >
                    Startup Log Access Code
                  </label>
                  <SecretInput
                    id="access-code"
                    autoFocus={!accessUnavailable}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={code}
                    disabled={submitting || accessUnavailable}
                    aria-describedby={
                      feedbackMessage ? "access-code-feedback" : undefined
                    }
                    aria-invalid={Boolean(feedbackMessage)}
                    onChange={(event) => {
                      setCode(event.target.value);
                      if (error) {
                        setError("");
                      }
                    }}
                    placeholder="Paste access code"
                    showLabel="Show access code"
                    hideLabel="Hide access code"
                    buttonSize="default"
                    mono
                    className={accessInputClass}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Find the current code in the local startup log.
                  </p>
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  {feedbackMessage ? (
                    <motion.p
                      key={accessUnavailable ? "restart" : "error"}
                      id="access-code-feedback"
                      role="alert"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.16 }}
                      className="rounded-xl border border-graph-status-error/30 bg-graph-status-error/10 px-3.5 py-3 text-[12px] leading-5 text-graph-status-error"
                    >
                      {feedbackMessage}
                    </motion.p>
                  ) : null}
                </AnimatePresence>

                <Button
                  type="submit"
                  variant="default"
                  disabled={submitting || accessUnavailable}
                  className={accessButtonClass}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Verifying
                    </>
                  ) : (
                    <>
                      Unlock
                      <ArrowRight
                        className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </ShellSurface>
        </motion.div>
      </div>
    </ShellBackground>
  );
}

function AppShell() {
  const { loading, state } = useAccess();

  if (loading) {
    return (
      <ShellBackground
        variant="access"
        className="flex min-h-screen items-center justify-center"
      >
        <PageLoadingState
          label="Loading access..."
          barClassName="skeleton-shimmer animate-none"
        />
      </ShellBackground>
    );
  }

  if (!state.authenticated) {
    return <AccessGate />;
  }

  return (
    <AgentProvider>
      <ImageViewerProvider>
        <AppContent />
      </ImageViewerProvider>
    </AgentProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AccessProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className:
              "rounded-md border border-border bg-surface-overlay text-foreground shadow-md",
          }}
        />
        <TooltipProvider delayDuration={300}>
          <AppShell />
        </TooltipProvider>
      </AccessProvider>
    </ThemeProvider>
  );
}

export default App;
