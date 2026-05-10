import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  createRole,
  deleteRole,
  fetchRolesBootstrap,
  updateRole,
} from "@/lib/api";
import type { RolesBootstrap } from "@/lib/api/roles";
import type { Role } from "@/types";
import {
  buildProvidersById,
  buildRolePayload,
  canSaveRoleChanges,
  createDefaultRoleModel,
  createEmptyRoleDraft,
  cycleToolState,
  createRoleDraft,
  getRoleConfigurableTools,
  getRolePanelBadgeLabel,
  getRolePanelTitle,
  getToolState,
  isRolePanelReadOnly,
  shouldLockRoleIdentityFields,
  validateRoleDraft,
  type RolePanelMode,
  type RoleDraft,
} from "@/pages/roles/lib";
import { cloneModelParams } from "@/lib/modelParams";
import {
  getRoutePathForRole,
  getRoutePathForRoleCreate,
  pushBrowserPath,
  replaceBrowserPath,
} from "@/lib/urlNavigation";
import { useAppRoute } from "@/hooks/useAppRoute";

export function useRolesPageState() {
  const route = useAppRoute();
  const [panelMode, setPanelMode] = useState<RolePanelMode | null>(
    route.roleMode,
  );
  const [activeRoleName, setActiveRoleName] = useState<string | null>(
    route.roleName,
  );
  const [draft, setDraft] = useState<RoleDraft>(createEmptyRoleDraft());
  const [saving, setSaving] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const appliedRouteKeyRef = useRef<string | null>(null);

  const {
    data: bootstrapData,
    isLoading: loading,
    mutate: mutateRolesBootstrap,
  } = useSWR("rolesBootstrap", fetchRolesBootstrap);

  const roles = useMemo(
    () => bootstrapData?.roles ?? [],
    [bootstrapData?.roles],
  );
  const tools = useMemo(
    () => bootstrapData?.tools ?? [],
    [bootstrapData?.tools],
  );
  const providers = useMemo(
    () => bootstrapData?.providers ?? [],
    [bootstrapData?.providers],
  );
  const configurableTools = useMemo(
    () => getRoleConfigurableTools(tools),
    [tools],
  );
  const providersById = useMemo(
    () => buildProvidersById(providers),
    [providers],
  );
  const activeRole = useMemo(
    () =>
      activeRoleName
        ? (roles.find((role) => role.name === activeRoleName) ?? null)
        : null,
    [activeRoleName, roles],
  );
  const activeProviderId = draft.model?.provider_id ?? "";
  const activeProviderModelOptions = useMemo(
    () =>
      activeProviderId ? (providersById[activeProviderId]?.models ?? []) : [],
    [activeProviderId, providersById],
  );
  const availableActiveProviderModelOptions = activeProviderModelOptions;
  const isPanelOpen = panelMode !== null;
  const isReadOnly = isRolePanelReadOnly(panelMode);
  const shouldLockIdentityFields = shouldLockRoleIdentityFields(
    panelMode,
    activeRole,
  );
  const panelBadgeLabel = getRolePanelBadgeLabel(panelMode, activeRole);
  const panelTitle = getRolePanelTitle(panelMode, activeRole);
  const canSave = canSaveRoleChanges(draft, saving);

  useEffect(() => {
    if (route.page !== "roles") {
      return;
    }

    const routeKey =
      route.roleMode === "create"
        ? "create"
        : route.roleName
          ? `${route.roleMode ?? "view"}:${route.roleName}`
          : "list";

    if (appliedRouteKeyRef.current === routeKey) {
      return;
    }

    if (route.roleMode === "create") {
      appliedRouteKeyRef.current = routeKey;
      setPanelMode("create");
      setActiveRoleName(null);
      setDraft(createEmptyRoleDraft());
      return;
    }

    if (route.roleName) {
      const role = roles.find((candidate) => candidate.name === route.roleName);
      if (!role) {
        if (!loading) {
          appliedRouteKeyRef.current = "list";
          setPanelMode(null);
          setActiveRoleName(null);
          setDraft(createEmptyRoleDraft());
          replaceBrowserPath(getRoutePathForRole(null));
        }
        return;
      }

      appliedRouteKeyRef.current = routeKey;
      setPanelMode(route.roleMode === "edit" ? "edit" : "view");
      setActiveRoleName(role.name);
      setDraft(createRoleDraft(role));
      return;
    }

    appliedRouteKeyRef.current = routeKey;
    setPanelMode(null);
    setActiveRoleName(null);
    setDraft(createEmptyRoleDraft());
  }, [loading, roles, route.page, route.roleMode, route.roleName]);

  const updateBootstrapRoles = useCallback(
    (nextRoles: Role[]) => {
      void mutateRolesBootstrap(
        {
          roles: nextRoles,
          tools,
          providers,
        } satisfies RolesBootstrap,
        false,
      );
    },
    [mutateRolesBootstrap, providers, tools],
  );

  const refreshRoles = useCallback(async () => {
    await mutateRolesBootstrap();
  }, [mutateRolesBootstrap]);

  const closePanel = useCallback(() => {
    appliedRouteKeyRef.current = "list";
    setPanelMode(null);
    setActiveRoleName(null);
    setDraft(createEmptyRoleDraft());
    pushBrowserPath(getRoutePathForRole(null));
  }, []);

  const openCreate = useCallback(() => {
    appliedRouteKeyRef.current = "create";
    setPanelMode("create");
    setActiveRoleName(null);
    setDraft(createEmptyRoleDraft());
    pushBrowserPath(getRoutePathForRoleCreate());
  }, []);

  const openView = useCallback((role: Role) => {
    appliedRouteKeyRef.current = `view:${role.name}`;
    setPanelMode("view");
    setActiveRoleName(role.name);
    setDraft(createRoleDraft(role));
    pushBrowserPath(getRoutePathForRole(role.name, "view"));
  }, []);

  const openEdit = useCallback((role: Role) => {
    appliedRouteKeyRef.current = `edit:${role.name}`;
    setPanelMode("edit");
    setActiveRoleName(role.name);
    setDraft(createRoleDraft(role));
    pushBrowserPath(getRoutePathForRole(role.name, "edit"));
  }, []);

  const updateDraft = useCallback(
    (updater: (current: RoleDraft) => RoleDraft) => {
      setDraft((current) => updater(current));
    },
    [],
  );

  const handleModelModeChange = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        updateDraft((current) => ({ ...current, model: null }));
        return;
      }
      if (providers.length === 0) {
        toast.error("Create a provider before setting a role model");
        return;
      }
      updateDraft((current) => ({
        ...current,
        model: current.model ?? createDefaultRoleModel(providers),
      }));
    },
    [providers, updateDraft],
  );

  const handleProviderChange = useCallback(
    (providerId: string) => {
      updateDraft((current) => ({
        ...current,
        model: current.model
          ? {
              provider_id: providerId,
              model: "",
            }
          : null,
      }));
    },
    [updateDraft],
  );

  const handleModelParamsModeChange = useCallback(
    (enabled: boolean) => {
      updateDraft((current) => ({
        ...current,
        model_params: enabled ? cloneModelParams(current.model_params) : null,
      }));
    },
    [updateDraft],
  );

  const handleSave = useCallback(async () => {
    const validationError = validateRoleDraft({
      activeRoleName,
      draft,
      roles,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const nextDraft = buildRolePayload(draft);

      if (panelMode === "edit" && activeRoleName) {
        const updates = activeRole?.is_builtin
          ? {
              model: nextDraft.model,
              model_params: nextDraft.model_params,
            }
          : nextDraft;
        const updated = await updateRole(activeRoleName, updates);
        updateBootstrapRoles(
          roles.map((role) => (role.name === activeRoleName ? updated : role)),
        );
        appliedRouteKeyRef.current = `view:${updated.name}`;
        setPanelMode("view");
        setActiveRoleName(updated.name);
        setDraft(createRoleDraft(updated));
        replaceBrowserPath(getRoutePathForRole(updated.name, "view"));
        toast.success("Role updated");
      } else {
        const created = await createRole(nextDraft);
        updateBootstrapRoles([created, ...roles]);
        appliedRouteKeyRef.current = `view:${created.name}`;
        setPanelMode("view");
        setActiveRoleName(created.name);
        setDraft(createRoleDraft(created));
        replaceBrowserPath(getRoutePathForRole(created.name, "view"));
        toast.success("Role created");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save role",
      );
    } finally {
      setSaving(false);
    }
  }, [
    activeRole,
    activeRoleName,
    draft,
    panelMode,
    roles,
    updateBootstrapRoles,
  ]);

  const requestDeleteRole = useCallback((role: Role) => {
    setRoleToDelete(role);
  }, []);

  const clearRoleToDelete = useCallback(() => {
    setRoleToDelete(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!roleToDelete) {
      return;
    }
    const name = roleToDelete.name;
    setRoleToDelete(null);
    try {
      await deleteRole(name);
      updateBootstrapRoles(roles.filter((role) => role.name !== name));
      if (activeRoleName === name) {
        appliedRouteKeyRef.current = "list";
        setPanelMode(null);
        setActiveRoleName(null);
        setDraft(createEmptyRoleDraft());
        replaceBrowserPath(getRoutePathForRole(null));
      }
      toast.success("Role deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete role",
      );
    }
  }, [activeRoleName, roleToDelete, roles, updateBootstrapRoles]);

  const cycleRoleToolState = useCallback(
    (toolName: string) => {
      updateDraft((current) => cycleToolState(current, toolName));
    },
    [updateDraft],
  );

  return {
    activeRole,
    activeRoleName,
    availableActiveProviderModelOptions,
    canSave,
    configurableTools,
    draft,
    isPanelOpen,
    isReadOnly,
    loading,
    panelBadgeLabel,
    panelMode,
    panelTitle,
    providers,
    providersById,
    refreshRoles,
    roleToDelete,
    roles,
    saving,
    shouldLockIdentityFields,
    actions: {
      clearRoleToDelete,
      closePanel,
      cycleRoleToolState,
      handleDelete,
      handleModelModeChange,
      handleModelParamsModeChange,
      handleProviderChange,
      handleSave,
      openCreate,
      openEdit,
      openView,
      requestDeleteRole,
      updateDraft,
    },
    getToolState: (toolName: string) => getToolState(draft, toolName),
  };
}
