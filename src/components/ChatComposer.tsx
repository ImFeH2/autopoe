import { ArrowUp } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatComposerProps {
  canSend: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  value: string;
}

export function ChatComposer({
  canSend,
  disabled,
  onChange,
  onSend,
  value,
}: ChatComposerProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <footer className="border-t p-4">
      <form
        className="mx-auto flex w-full max-w-3xl items-end gap-2"
        onSubmit={submit}
      >
        <Textarea
          aria-label="Message Leader"
          disabled={disabled}
          name="message"
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          placeholder="Message Leader"
          rows={1}
          value={value}
        />
        <Button
          aria-label="Send"
          disabled={!canSend}
          size="icon-lg"
          type="submit"
        >
          <ArrowUp />
        </Button>
      </form>
    </footer>
  );
}
