import { createContext, useContext } from "react";

import type { FlowentToastTone } from "@/components/flowent/types";

export type FlowentToastInput =
  | string
  | {
      description?: string;
      duration?: number;
      message: string;
    };

export type FlowentToastApi = {
  dismiss: (id: string) => void;
  error: (input: FlowentToastInput) => string;
  info: (input: FlowentToastInput) => string;
  success: (input: FlowentToastInput) => string;
};

export const FlowentToastContext = createContext<FlowentToastApi | null>(null);

export function useFlowentToast() {
  const context = useContext(FlowentToastContext);
  if (!context) {
    throw new Error("useFlowentToast must be used within FlowentToastProvider");
  }
  return context;
}

export type { FlowentToastTone };
