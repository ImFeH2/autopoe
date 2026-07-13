import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronRight, Sparkles } from "lucide-react";

import { MarkdownMessage } from "@/components/flowent/markdown-message";
import { Button } from "@/components/ui/button";
import type { Message } from "@/features/workspace/model/message-types";
import { cn } from "@/lib/utils";

export function WorkspaceSystemMessage({ message }: { message: Message }) {
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const isCompactContextMessage =
    message.content === "Context compacted" ||
    message.content === "Context optimized";
  const Icon =
    message.content === "Context optimized"
      ? Sparkles
      : message.content === "Context compacted"
        ? Check
        : null;

  if (isCompactContextMessage) {
    const summaryId = `${message.id}-summary`;

    return (
      <div className="mx-auto flex w-full max-w-4xl py-3">
        <div className="w-full overflow-hidden rounded-xl border border-white/10 bg-input/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <Button
            aria-controls={summaryId}
            aria-expanded={isOpen}
            className="h-auto w-full justify-between rounded-xl border-0 bg-transparent px-4 py-3 text-left text-base leading-5 text-white/80 shadow-none hover:bg-input/30 hover:text-white focus-visible:ring-2 focus-visible:ring-white/20"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
            variant="ghost"
          >
            <span className="flex min-w-0 items-center gap-2">
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-white/55"
                />
              ) : null}
              <span className="truncate font-medium">{message.content}</span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-white/45 transition-transform duration-200",
                isOpen && "rotate-90",
              )}
            />
          </Button>
          <AnimatePresence initial={false}>
            {isOpen ? (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                className="overflow-hidden"
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                initial={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { height: 0, opacity: 0 }
                }
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              >
                <div
                  aria-label={`${message.content} summary`}
                  className="border-t border-white/10 px-4 py-3 text-sm leading-6 text-white/80"
                  id={summaryId}
                  role="region"
                >
                  <MarkdownMessage content={message.summary ?? ""} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl justify-center py-3">
      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-input/30 px-3 py-1.5 text-base leading-5 text-white/70">
        {Icon ? (
          <Icon aria-hidden="true" className="size-3.5 text-white/50" />
        ) : null}
        {message.content}
      </div>
    </div>
  );
}
