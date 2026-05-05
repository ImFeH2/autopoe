import { Check, UserRound } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

interface RoleSearchPickerProps {
  roles: Role[];
  loadingRoles: boolean;
  selectedRoleName: string;
  onRoleNameChange: (nextValue: string) => void;
  className?: string;
}

export function RoleSearchPicker({
  roles,
  loadingRoles,
  selectedRoleName,
  onRoleNameChange,
  className,
}: RoleSearchPickerProps) {
  const selectedRole = useMemo(
    () => roles.find((role) => role.name === selectedRoleName) ?? null,
    [roles, selectedRoleName],
  );
  const selectedRoleUnavailable =
    Boolean(selectedRoleName) && !loadingRoles && !selectedRole;

  return (
    <div
      className={cn(
        "grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_16rem]",
        className,
      )}
    >
      <Command className="min-h-[17rem] rounded-xl border border-border bg-background/35">
        <CommandInput
          aria-label="Search roles"
          placeholder="Search roles..."
          disabled={loadingRoles || roles.length === 0}
        />
        <CommandList className="max-h-[18rem]">
          {loadingRoles ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Loading roles...
            </div>
          ) : roles.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No roles available.
            </div>
          ) : (
            <>
              <CommandEmpty>No matching roles.</CommandEmpty>
              <CommandGroup heading="Roles">
                {roles.map((role) => {
                  const selected = selectedRoleName === role.name;

                  return (
                    <CommandItem
                      key={role.name}
                      value={`${role.name} ${role.description}`}
                      onSelect={() => onRoleNameChange(role.name)}
                      className={cn(
                        "items-start gap-3 rounded-md px-3 py-2.5",
                        selected && "bg-accent/60 text-accent-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-transparent",
                        )}
                      >
                        <Check className="size-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {role.name}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[12px] leading-relaxed text-muted-foreground">
                          {role.description}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>

      <div className="min-h-[10rem] rounded-xl border border-border bg-card/35 p-4">
        <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <UserRound className="size-4" />
          Selected role
        </div>
        {selectedRole ? (
          <div className="mt-4 min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-[15px] font-semibold text-foreground">
                {selectedRole.name}
              </p>
              {selectedRole.is_builtin ? (
                <Badge variant="outline" className="h-5 shrink-0">
                  Built-in
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 line-clamp-5 text-[12px] leading-relaxed text-muted-foreground">
              {selectedRole.description}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            {selectedRoleUnavailable
              ? "Selected role is not available."
              : "Choose a role to continue."}
          </p>
        )}
      </div>
    </div>
  );
}
