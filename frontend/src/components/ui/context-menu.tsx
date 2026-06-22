import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  );
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-[150] min-w-36 overflow-auto rounded-2xl border border-white/10 bg-[#161616] p-1 text-white shadow-md shadow-black/20 outline-none duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        data-slot="context-menu-content"
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  variant?: "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "relative flex h-[33px] cursor-pointer select-none items-center gap-2 rounded-xl px-2 py-1.5 text-sm leading-[21px] text-white outline-none transition-colors duration-100 focus:bg-white/[0.08] data-disabled:pointer-events-none data-disabled:opacity-50",
        variant === "destructive" && "text-[#f2787e] focus:text-[#f2787e]",
        className,
      )}
      data-slot="context-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger };
