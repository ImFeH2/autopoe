import { PageScaffold } from "@/components/layout/PageScaffold";
import { PageLoadingState } from "@/components/layout/PageLoadingState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AccessConfigurationSection,
  AssistantConfigurationSection,
  LeaderConfigurationSection,
  ModelConfigurationSection,
  PathConfigurationSection,
  SettingsFooter,
  SettingsHeader,
} from "@/pages/settings/SettingsSections";
import { useSettingsPageState } from "@/pages/settings/useSettingsPageState";
import {
  getRoutePathForSettings,
  pushBrowserPath,
  type SettingsSectionId,
} from "@/lib/urlNavigation";
import { useAppRoute } from "@/hooks/useAppRoute";

const SETTINGS_SECTIONS: SettingsSectionId[] = [
  "model",
  "assistant",
  "leader",
  "access",
  "path",
];

export function SettingsPage() {
  const route = useAppRoute();
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
    handleSave,
    knownSafeInputTokens,
    leaderRole,
    loading,
    providers,
    roles,
    saving,
    settings,
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
      <div className="h-full min-h-0 overflow-y-auto pr-2 scrollbar-none pb-20">
        <div className="mx-auto max-w-[680px] pb-10 pt-6">
          <SettingsHeader
            accessDraftError={accessDraftError}
            onSave={() => {
              void handleSave();
            }}
            saving={saving}
            settings={settings}
          />

          <Tabs
            value={route.settingsSection}
            onValueChange={(value) => {
              pushBrowserPath(
                getRoutePathForSettings(value as SettingsSectionId),
              );
            }}
            className="w-full"
          >
            <TabsList className="mb-8 w-full justify-start h-auto flex-wrap bg-transparent p-0 gap-6 border-b border-border/40 rounded-none">
              {SETTINGS_SECTIONS.map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none bg-transparent border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground text-muted-foreground rounded-none px-1 pb-2.5 pt-2 hover:text-foreground transition-colors"
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="model" className="mt-0">
              <ModelConfigurationSection
                activeProvider={activeProvider}
                activeProviderModels={activeProviderModels}
                availableActiveProviderModels={availableActiveProviderModels}
                effectiveContextWindowTokens={effectiveContextWindowTokens}
                effectiveModelCapabilities={effectiveModelCapabilities}
                knownSafeInputTokens={knownSafeInputTokens}
                onSettingsChange={updateSettings}
                providers={providers}
                settings={settings}
              />
            </TabsContent>

            <TabsContent value="assistant" className="mt-0">
              <AssistantConfigurationSection
                assistantRole={assistantRole}
                onSettingsChange={updateSettings}
                roles={roles}
                settings={settings}
              />
            </TabsContent>

            <TabsContent value="leader" className="mt-0">
              <LeaderConfigurationSection
                leaderRole={leaderRole}
                onSettingsChange={updateSettings}
                roles={roles}
                settings={settings}
              />
            </TabsContent>

            <TabsContent value="access" className="mt-0">
              <AccessConfigurationSection
                accessDraft={accessDraft}
                accessDraftError={accessDraftError}
                onAccessDraftChange={updateAccessDraft}
              />
            </TabsContent>

            <TabsContent value="path" className="mt-0">
              <PathConfigurationSection
                onSettingsChange={updateSettings}
                settings={settings}
              />
            </TabsContent>
          </Tabs>

          <SettingsFooter appVersion={appVersion} />
        </div>
      </div>
    </PageScaffold>
  );
}
