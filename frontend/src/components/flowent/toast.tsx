import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";

import { buttonVariants } from "@/components/ui/button-variants";
import { mutedTextClassName } from "@/components/flowent/styles";
import {
  FlowentToastContext,
  type FlowentToastApi,
  type FlowentToastInput,
} from "@/components/flowent/toast-context";
import type {
  FlowentToast,
  FlowentToastTone,
} from "@/components/flowent/types";
import { cn } from "@/lib/utils";

const maxToastCount = 3;
const defaultToastDuration = 4000;
const nativeToastDuration = 2_147_483_647;
let toastId = 0;
let flowentToasts: FlowentToast[] = [];
const toastListeners = new Set<() => void>();

const normalizeToastInput = (input: FlowentToastInput) => {
  if (typeof input === "string") {
    return { message: input };
  }
  return input;
};

const createToastId = () => {
  toastId += 1;
  return `flowent-toast-${toastId}`;
};

const notifyToastListeners = () => {
  for (const listener of toastListeners) {
    listener();
  }
};

const updateToastStore = (
  updater: (currentToasts: FlowentToast[]) => FlowentToast[],
) => {
  flowentToasts = updater(flowentToasts);
  notifyToastListeners();
};

const subscribeToastStore = (listener: () => void) => {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
};

const dismissToast = (id: string) => {
  updateToastStore((currentToasts) =>
    currentToasts.filter((toast) => toast.id !== id),
  );
};

const notifyToast = (tone: FlowentToastTone, input: FlowentToastInput) => {
  const toastInput = normalizeToastInput(input);
  const message = toastInput.message.trim();
  if (!message) {
    return "";
  }

  const nextToast: FlowentToast = {
    description: toastInput.description?.trim() || undefined,
    duration: toastInput.duration ?? defaultToastDuration,
    id: createToastId(),
    message,
    tone,
  };

  updateToastStore((currentToasts) =>
    [...currentToasts, nextToast].slice(-maxToastCount),
  );
  return nextToast.id;
};

const flowentToastApi: FlowentToastApi = {
  dismiss: dismissToast,
  error: (input) => notifyToast("error", input),
  info: (input) => notifyToast("info", input),
  success: (input) => notifyToast("success", input),
};

export function FlowentToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<FlowentToast[]>(flowentToasts);

  useEffect(() => {
    const syncToasts = () => setToasts(flowentToasts);
    const unsubscribe = subscribeToastStore(syncToasts);
    syncToasts();

    return () => {
      unsubscribe();
      if (toastListeners.size === 0) {
        flowentToasts = [];
      }
    };
  }, []);

  return (
    <FlowentToastContext.Provider value={flowentToastApi}>
      <ToastPrimitive.Provider
        duration={defaultToastDuration}
        label="Notification"
        swipeDirection="right"
      >
        {children}
        <FlowentToastViewport onDismiss={dismissToast} toasts={toasts} />
      </ToastPrimitive.Provider>
    </FlowentToastContext.Provider>
  );
}

function FlowentToastViewport({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: string) => void;
  toasts: FlowentToast[];
}) {
  const [isPaused, setIsPaused] = useState(false);

  return (
    <ToastPrimitive.Viewport
      aria-label="Notifications"
      className="fixed right-4 bottom-4 z-[80] m-0 flex w-[calc(100vw-2rem)] max-w-72 list-none flex-col items-end gap-2 p-0 outline-none max-[640px]:right-3 max-[640px]:bottom-3 max-[640px]:w-[calc(100vw-1.5rem)] max-[640px]:max-w-none"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node)) {
          setIsPaused(false);
          return;
        }
        if (!event.currentTarget.contains(nextTarget)) {
          setIsPaused(false);
        }
      }}
      onFocus={() => setIsPaused(true)}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {toasts.map((toast) => (
        <FlowentToastCard
          isPaused={isPaused}
          key={toast.id}
          onDismiss={onDismiss}
          toast={toast}
        />
      ))}
    </ToastPrimitive.Viewport>
  );
}

function FlowentToastCard({
  isPaused,
  onDismiss,
  toast,
}: {
  isPaused: boolean;
  onDismiss: (id: string) => void;
  toast: FlowentToast;
}) {
  const shouldReduceMotion = useReducedMotion();
  const remainingDurationRef = useRef(toast.duration);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const Icon = toastIconByTone[toast.tone];

  const clearTimer = useCallback(() => {
    if (timeoutRef.current === null) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  useEffect(() => {
    remainingDurationRef.current = toast.duration;
    startedAtRef.current = 0;
    clearTimer();
  }, [clearTimer, toast.duration, toast.id]);

  useEffect(() => {
    if (toast.duration <= 0) {
      return;
    }

    if (isPaused) {
      if (startedAtRef.current) {
        remainingDurationRef.current = Math.max(
          0,
          remainingDurationRef.current - (Date.now() - startedAtRef.current),
        );
        startedAtRef.current = 0;
      }
      clearTimer();
      return;
    }

    if (remainingDurationRef.current <= 0) {
      onDismiss(toast.id);
      return;
    }

    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, remainingDurationRef.current);

    return () => {
      if (startedAtRef.current) {
        remainingDurationRef.current = Math.max(
          0,
          remainingDurationRef.current - (Date.now() - startedAtRef.current),
        );
        startedAtRef.current = 0;
      }
      clearTimer();
    };
  }, [clearTimer, isPaused, onDismiss, toast.duration, toast.id]);

  return (
    <ToastPrimitive.Root
      className="w-full max-w-72 list-none outline-none max-[640px]:max-w-none"
      duration={nativeToastDuration}
      forceMount
      open
      role={toast.tone === "error" ? "alert" : "status"}
      type={toast.tone === "error" ? "foreground" : "background"}
    >
      <motion.div
        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border border-white/10 bg-black p-3 text-white shadow-[0_14px_34px_rgba(0,0,0,0.48)] ring-1 ring-white/5"
        initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 20 }}
        layout
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            toastToneClassName[toast.tone],
          )}
        />
        <div className="grid min-w-0 gap-0.5">
          <ToastPrimitive.Title className="text-xs leading-4 font-medium text-white">
            {toast.message}
          </ToastPrimitive.Title>
          {toast.description ? (
            <ToastPrimitive.Description
              className={cn("text-[11px] leading-[1.35]", mutedTextClassName)}
            >
              {toast.description}
            </ToastPrimitive.Description>
          ) : null}
        </div>
        <ToastPrimitive.Close
          aria-label="Dismiss notification"
          className={cn(
            buttonVariants({ size: "icon-xs", variant: "ghost" }),
            "-mt-1 -mr-1 size-6 p-0 text-white/55 hover:text-white",
          )}
          onClick={() => onDismiss(toast.id)}
          type="button"
        >
          <X aria-hidden="true" />
        </ToastPrimitive.Close>
      </motion.div>
    </ToastPrimitive.Root>
  );
}

const toastIconByTone = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
} satisfies Record<FlowentToastTone, typeof AlertCircle>;

const toastToneClassName = {
  error: "text-destructive",
  info: "text-white/70",
  success: "text-emerald-300",
} satisfies Record<FlowentToastTone, string>;
