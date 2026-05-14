import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { SecretInput } from "@/components/form/FormControls";
import {
  ShellBackground,
  ShellSurface,
} from "@/components/layout/ShellBackground";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/context/useAccess";

const accessInputClass =
  "h-12 w-full rounded-xl border border-input bg-background/55 px-4 pr-12 font-mono text-[15px] text-foreground transition-[border-color,background-color] placeholder:text-muted-foreground/70 focus:bg-background/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

function formatAccessError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Failed to verify access code";
  }
  return error.message.replace(/^Failed to verify access code:\s*/u, "");
}

export function AccessGate() {
  const { login, state } = useAccess();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const accessUnavailable = state.requires_restart;
  const restartMessage =
    "Access was reset locally. Restart Flowent to generate a new access code.";
  const feedbackMessage = accessUnavailable ? restartMessage : error;

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (accessUnavailable) {
      return;
    }
    if (!code.trim()) {
      setError("Enter the access code");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      await login(code);
      setCode("");
    } catch (loginError) {
      setError(formatAccessError(loginError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ShellBackground variant="access">
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.04, ease: "easeOut" }}
          className="mb-7 flex items-center gap-2 text-[12px] font-medium text-muted-foreground/80"
        >
          <span
            aria-hidden="true"
            className="size-1 rounded-full bg-foreground/70"
          />
          Flowent
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.08, ease: "easeOut" }}
          className="w-full max-w-[420px]"
        >
          <ShellSurface
            variant="access"
            className="rounded-2xl border border-border/80 p-7 text-popover-foreground sm:p-8"
          >
            <form
              className="relative z-10"
              onSubmit={(event) => void handleSubmit(event)}
            >
              <div className="flex flex-col items-center text-center">
                <h1 className="text-[22px] font-medium leading-tight text-foreground">
                  Enter Access Code
                </h1>
              </div>

              <div className="mt-6 space-y-3.5">
                <div className="space-y-2">
                  <label
                    htmlFor="access-code"
                    className="block text-[12px] font-medium text-foreground/80"
                  >
                    Startup Log Access Code
                  </label>
                  <SecretInput
                    id="access-code"
                    autoFocus={!accessUnavailable}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={code}
                    disabled={isSubmitting || accessUnavailable}
                    aria-describedby={
                      feedbackMessage ? "access-code-feedback" : undefined
                    }
                    aria-invalid={Boolean(feedbackMessage)}
                    onChange={(event) => {
                      setCode(event.target.value);
                      if (error) {
                        setError("");
                      }
                    }}
                    placeholder="Paste access code"
                    showLabel="Show access code"
                    hideLabel="Hide access code"
                    buttonSize="default"
                    mono
                    className={accessInputClass}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Find the current code in the local startup log.
                  </p>
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  {feedbackMessage ? (
                    <motion.p
                      key={accessUnavailable ? "restart" : "error"}
                      id="access-code-feedback"
                      role="alert"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.16 }}
                      className="rounded-xl border border-graph-status-error/30 bg-graph-status-error/10 px-3.5 py-3 text-[12px] leading-5 text-graph-status-error"
                    >
                      {feedbackMessage}
                    </motion.p>
                  ) : null}
                </AnimatePresence>

                <Button
                  type="submit"
                  variant="default"
                  disabled={isSubmitting || accessUnavailable}
                  className="group h-11 w-full text-[13px]"
                >
                  {isSubmitting ? (
                    <>
                      <LoaderCircle
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Verifying
                    </>
                  ) : (
                    <>
                      Unlock
                      <ArrowRight
                        className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </ShellSurface>
        </motion.div>
      </div>
    </ShellBackground>
  );
}
