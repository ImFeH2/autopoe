import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function AnimatedExpandableContent({
  children,
  isOpen,
}: {
  children: ReactNode;
  isOpen: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.div
          animate={
            shouldReduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }
          }
          className="overflow-hidden"
          data-slot="workspace-expandable-content"
          exit={shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
          initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 0.18, ease: [0.32, 0.72, 0, 1] }
          }
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
