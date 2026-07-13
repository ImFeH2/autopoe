import { createContext, useContext } from "react";

export type FlowentToastTone = "error" | "info" | "success";

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
