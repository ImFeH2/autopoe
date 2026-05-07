import { motion } from "motion/react";
import { Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { FormIconButton } from "@/components/form/FormControls";
import { PanelResizer } from "@/components/PanelResizer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { providerTypeLabel } from "@/lib/providerTypes";
import type { Provider } from "@/types";

interface ProvidersSidebarProps {
  isDragging: boolean;
  loading: boolean;
  onCreate: () => void;
  onDelete: (provider: Provider) => void;
  onRefresh: () => void;
  onResizeStart: (event: React.MouseEvent) => void;
  onSelect: (provider: Provider) => void;
  panelWidth: number;
  providers: Provider[];
  selectedId: string | null;
}

export function ProvidersSidebar({
  isDragging,
  loading,
  onCreate,
  onDelete,
  onRefresh,
  onResizeStart,
  onSelect,
  panelWidth,
  providers,
  selectedId,
}: ProvidersSidebarProps) {
  return (
    <div
      style={{ width: `${panelWidth}px` }}
      className="relative flex shrink-0 flex-col border-r border-border bg-card/20 pt-8 pl-8"
    >
      <div className="flex shrink-0 items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground/80">
            Providers
          </span>
        </div>
        <div className="flex items-center gap-1">
          <FormIconButton
            onClick={onRefresh}
            disabled={loading}
            className="size-7"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </FormIconButton>
          <FormIconButton onClick={onCreate} className="size-7">
            <Plus className="size-3.5" />
          </FormIconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {loading ? (
          <div className="space-y-1">
            {[...Array(3)].map((_, index) => (
              <div
                key={index}
                className="h-10 w-full animate-pulse rounded-lg bg-accent/20"
              />
            ))}
          </div>
        ) : providers.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-10 text-center"
          >
            <p className="text-[13px] text-muted-foreground">No providers</p>
            <Button type="button" size="sm" onClick={onCreate} className="mt-4">
              <Plus className="size-3" />
              Add your first provider
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-0.5">
            {providers.map((provider, index) => (
              <motion.div
                key={provider.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
                className={cn(
                  "group relative flex w-full items-center justify-between rounded-lg transition-all",
                  selectedId === provider.id
                    ? "bg-accent/55 text-foreground"
                    : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                )}
              >
                <div
                  className={cn(
                    "absolute inset-y-1 left-0 w-px rounded-full bg-ring/60 transition-opacity",
                    selectedId === provider.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(provider)}
                  className="h-auto min-w-0 flex-1 justify-start rounded-lg bg-transparent px-3 py-2.5 text-left text-inherit shadow-none hover:bg-transparent hover:text-inherit focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 pl-2">
                    <span className="block truncate text-[13px] font-medium">
                      {provider.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {providerTypeLabel(provider.type)}
                    </span>
                  </span>
                </Button>
                <FormIconButton
                  onClick={() => {
                    onDelete(provider);
                  }}
                  className="mr-2 size-6 shrink-0 border-transparent bg-transparent opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </FormIconButton>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <PanelResizer
        position="right"
        isDragging={isDragging}
        onMouseDown={onResizeStart}
      />
    </div>
  );
}
