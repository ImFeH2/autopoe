import type { KeyboardEvent } from "react";
import { IconButton, TextArea, Tooltip } from "@radix-ui/themes";
import { ArrowUpIcon } from "@/components/Icons";

interface ChatComposerProps {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function ChatComposer({
  disabled,
  value,
  onChange,
  onSubmit,
}: ChatComposerProps) {
  const canSubmit = !disabled && value.trim().length > 0;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }

  return (
    <div className="composer-dock">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit();
          }
        }}
      >
        <TextArea
          aria-label="Message"
          className="composer-input"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Flowent"
          rows={2}
          value={value}
          variant="soft"
        />
        <div className="composer-footer">
          <span className="composer-mode">
            <span className="composer-mode-dot" aria-hidden="true" />
            Local demo
          </span>
          <Tooltip content={disabled ? "Running" : "Send"}>
            <IconButton
              aria-label="Send"
              className="send-button"
              disabled={!canSubmit}
              radius="full"
              type="submit"
              variant="solid"
            >
              <ArrowUpIcon />
            </IconButton>
          </Tooltip>
        </div>
      </form>
    </div>
  );
}
