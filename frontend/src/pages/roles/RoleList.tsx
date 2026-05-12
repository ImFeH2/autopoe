import { motion } from "motion/react";
import { Edit2, Eye, Plus, Trash2, Users } from "lucide-react";
import { FormIconButton } from "@/components/form/FormControls";
import { Button } from "@/components/ui/button";
import { PageState, StatusChip } from "@/components/surface";
import { getRoleModelSummary, getRoleToolSummary } from "@/pages/roles/lib";
import { cn } from "@/lib/utils";
import type { Provider, Role } from "@/types";

interface RoleListProps {
  activeRole: Role | null;
  onCreateRole: () => void;
  onDeleteRole: (role: Role) => void;
  onEditRole: (role: Role) => void;
  onViewRole: (role: Role) => void;
  providersById: Record<string, Provider>;
  roles: Role[];
}

export function RoleList({
  activeRole,
  onCreateRole,
  onDeleteRole,
  onEditRole,
  onViewRole,
  providersById,
  roles,
}: RoleListProps) {
  if (roles.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex h-full flex-col items-center justify-center text-center"
      >
        <PageState
          icon={Users}
          title="No roles yet"
          action={
            <Button type="button" size="sm" onClick={onCreateRole}>
              <Plus className="size-4" />
              New Role
            </Button>
          }
          className="border-transparent bg-transparent"
        />
      </motion.div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-2 scrollbar-none">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-2 grid grid-cols-[260px_1fr_120px_100px] gap-4 px-4 pb-3">
          <span className="text-[11px] font-medium text-muted-foreground">
            Name
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">
            Model
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">
            Tools
          </span>
          <span />
        </div>

        <div className="space-y-1">
          {roles.map((role, index) => (
            <RoleListRow
              key={role.name}
              activeRoleName={activeRole?.name ?? null}
              index={index}
              onDeleteRole={onDeleteRole}
              onEditRole={onEditRole}
              onViewRole={onViewRole}
              providersById={providersById}
              role={role}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface RoleListRowProps {
  activeRoleName: string | null;
  index: number;
  onDeleteRole: (role: Role) => void;
  onEditRole: (role: Role) => void;
  onViewRole: (role: Role) => void;
  providersById: Record<string, Provider>;
  role: Role;
}

function RoleListRow({
  activeRoleName,
  index,
  onDeleteRole,
  onEditRole,
  onViewRole,
  providersById,
  role,
}: RoleListRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(
        "group grid grid-cols-[220px_1fr_100px_80px] items-center gap-4 rounded-xl px-4 py-3.5 transition-colors",
        activeRoleName === role.name ? "bg-accent/25" : "hover:bg-accent/15",
      )}
    >
      <div className="min-w-0 pr-2">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {role.name}
          </span>
          {role.is_builtin ? (
            <StatusChip tone="muted" className="px-1.5 py-0.5 text-[9px]">
              Built-in
            </StatusChip>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
          {role.description}
        </p>
      </div>

      <div className="min-w-0 pr-2">
        <span className="block truncate text-[13px] text-muted-foreground">
          {getRoleModelSummary(role, providersById)}
        </span>
      </div>

      <div className="pr-2">
        <span className="font-mono text-[13px] text-muted-foreground">
          {getRoleToolSummary(role)}
        </span>
      </div>

      <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <FormIconButton
          onClick={() => onViewRole(role)}
          aria-label={`View ${role.name}`}
          title={`View ${role.name}`}
          className="size-7"
        >
          <Eye className="size-3.5" />
        </FormIconButton>
        <FormIconButton
          onClick={() => onEditRole(role)}
          aria-label={`Edit ${role.name}`}
          title={`Edit ${role.name}`}
          className="size-7"
        >
          <Edit2 className="size-3.5" />
        </FormIconButton>
        {!role.is_builtin ? (
          <FormIconButton
            onClick={() => onDeleteRole(role)}
            aria-label={`Delete ${role.name}`}
            title={`Delete ${role.name}`}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </FormIconButton>
        ) : null}
      </div>
    </motion.div>
  );
}
