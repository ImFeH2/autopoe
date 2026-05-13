import { useMediaQuery } from "@/hooks/useMediaQuery";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot,
  FolderCog,
  KeyRound,
  Network,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  AccessConfigurationSection,
  AssistantConfigurationSection,
  LeaderConfigurationSection,
  ModelConfigurationSection,
  PathConfigurationSection,
  SettingsFooter,
} from "@/pages/settings/SettingsSections";
import { useSettingsPageState } from "@/pages/settings/useSettingsPageState";
import {
  getRoutePathForSettings,
  pushBrowserPath,
  type SettingsSectionId,
} from "@/lib/urlNavigation";
import { useAppRoute } from "@/hooks/useAppRoute";

const SETTINGS_SECTIONS: SettingsSectionId[] = [
  "access",
  "path",
  "assistant",
  "leader",
  "model",
];

const SETTINGS_SECTION_NAV = {
  access: {
    icon: KeyRound,
    label: "Access Configuration",
  },
  assistant: {
    icon: Bot,
    label: "Assistant Configuration",
  },
  leader: {
    icon: Network,
    label: "Leader Configuration",
  },
  model: {
    icon: SlidersHorizontal,
    label: "Model Configuration",
  },
  path: {
    icon: FolderCog,
    label: "Path Configuration",
  },
} satisfies Record<SettingsSectionId, { icon: LucideIcon; label: string }>;

export function SettingsPage() {
  const route = useAppRoute();
  const useHorizontalCategories = useMediaQuery("(max-width: 1023px)");
  const {
    accessDraft,
    accessDraftError,
    activeProvider,
    activeProviderModels,
    availableActiveProviderModels,
    appVersion,
    assistantRole,
    effectiveContextWindowTokens,
    effectiveModelCapabilities,
    handleAccessCodeUpdate,
    knownSafeInputTokens,
    leaderRole,
    loading,
    providers,
    roles,
    saveSettingsChange,
    saveStateFor,
    settings,
    commitSettingsChange,
    updateAccessDraft,
    updateSettings,
  } = useSettingsPageState();

  if (loading || !settings) {
    return (
      <PageLoadingState
        label="Loading settings..."
        textClassName="text-[13px]"
      />
    );
  }

  return (
    <PageScaffold>
      <div className="h-full min-h-0 overflow-y-auto pr-2 pb-20 scrollbar-none">
        <div className="mx-auto w-full max-w-[960px] pb-10 pt-6">
          <Tabs
            value={route.settingsSection}
            onValueChange={(value) => {
              pushBrowserPath(
                getRoutePathForSettings(value as SettingsSectionId),
              );
            }}
            orientation={useHorizontalCategories ? "horizontal" : "vertical"}
            className="w-full flex-col gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start"
          >
            <TabsList
              aria-label="Settings categories"
              className="mb-6 flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none border-b border-border/40 bg-transparent p-0 pb-2 lg:sticky lg:top-6 lg:mb-0 lg:w-full lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:border-border/40 lg:pb-0 lg:pr-4"
              variant="line"
            >
              {SETTINGS_SECTIONS.map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="h-10 w-auto shrink-0 justify-start gap-2 rounded-md border border-transparent bg-transparent px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground data-[state=active]:border-border/70 data-[state=active]:bg-accent/25 data-[state=active]:text-foreground data-[state=active]:shadow-none lg:w-full lg:justify-start"
                >
                  {(() => {
                    const section = SETTINGS_SECTION_NAV[t];
                    const Icon = section.icon;
                    return (
                      <>
                        <Icon className="size-4" aria-hidden="true" />
                        <span>{section.label}</span>
                      </>
                    );
                  })()}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="model" className="mt-0 min-w-0">
              <ModelConfigurationSection
                activeProvider={activeProvider}
                activeProviderModels={activeProviderModels}
                availableActiveProviderModels={availableActiveProviderModels}
                effectiveContextWindowTokens={effectiveContextWindowTokens}
                effectiveModelCapabilities={effectiveModelCapabilities}
                knownSafeInputTokens={knownSafeInputTokens}
                onSettingsChange={commitSettingsChange}
                providers={providers}
                saveSettingsChange={saveSettingsChange}
                saveStateFor={saveStateFor}
                settings={settings}
                updateSettings={updateSettings}
              />
            </TabsContent>

            <TabsContent value="assistant" className="mt-0 min-w-0">
              <AssistantConfigurationSection
                assistantRole={assistantRole}
                onSettingsChange={commitSettingsChange}
                roles={roles}
                saveSettingsChange={saveSettingsChange}
                saveStateFor={saveStateFor}
                settings={settings}
                updateSettings={updateSettings}
              />
            </TabsContent>

            <TabsContent value="leader" className="mt-0 min-w-0">
              <LeaderConfigurationSection
                leaderRole={leaderRole}
                onSettingsChange={commitSettingsChange}
                roles={roles}
                saveStateFor={saveStateFor}
                settings={settings}
              />
            </TabsContent>

            <TabsContent value="access" className="mt-0 min-w-0">
              <AccessConfigurationSection
                accessDraft={accessDraft}
                accessDraftError={accessDraftError}
                onAccessCodeUpdate={() => {
                  void handleAccessCodeUpdate();
                }}
                onAccessDraftChange={updateAccessDraft}
                saveState={saveStateFor("access")}
              />
            </TabsContent>

            <TabsContent value="path" className="mt-0 min-w-0">
              <PathConfigurationSection
                onSettingsChange={commitSettingsChange}
                saveSettingsChange={saveSettingsChange}
                saveState={saveStateFor("working_dir")}
                settings={settings}
                updateSettings={updateSettings}
              />
            </TabsContent>
          </Tabs>

          <SettingsFooter appVersion={appVersion} />
        </div>
      </div>
    </PageScaffold>
  );
}
