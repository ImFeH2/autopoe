import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./button";
import { X } from "./icons";

type DialogProps = {
  children: ReactNode;
  description: string;
  onCloseAutoFocus?: () => boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  trigger: ReactElement;
};

export function Dialog({
  children,
  description,
  onCloseAutoFocus,
  onOpenChange,
  open,
  title,
  trigger,
}: DialogProps) {
  return (
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content
          className="ui-dialog-content"
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus?.()) {
              event.preventDefault();
            }
          }}
        >
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          <header className="ui-dialog-header">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button aria-label="Close dialog" size="icon" variant="quiet">
                <X aria-hidden="true" size={15} />
              </Button>
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
