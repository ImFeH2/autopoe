import { lazy, Suspense } from "react";

const DevelopmentAgentation = import.meta.env.DEV
  ? lazy(async () => {
      const { Agentation } = await import("agentation");

      return { default: Agentation };
    })
  : null;

export function AgentationRoot() {
  if (!DevelopmentAgentation) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <DevelopmentAgentation />
    </Suspense>
  );
}
