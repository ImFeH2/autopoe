import { type KeyboardEvent, type RefObject, useEffect, useRef } from "react";

export function useSoftKeyboardSubmit({
  isEnabled,
  onSubmit,
  textareaRef,
}: {
  isEnabled: boolean;
  onSubmit: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const allowNextLineBreakRef = useRef(false);
  const isEnabledRef = useRef(isEnabled);
  const submitRef = useRef(onSubmit);
  isEnabledRef.current = isEnabled;
  submitRef.current = onSubmit;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const handleBeforeInput = (event: InputEvent) => {
      if (!isEnabledRef.current) {
        return;
      }
      if (allowNextLineBreakRef.current) {
        allowNextLineBreakRef.current = false;
        return;
      }
      if (
        event.inputType !== "insertLineBreak" &&
        event.inputType !== "insertParagraph"
      ) {
        return;
      }
      event.preventDefault();
      submitRef.current();
    };

    textarea.addEventListener("beforeinput", handleBeforeInput);

    return () => textarea.removeEventListener("beforeinput", handleBeforeInput);
  }, [textareaRef]);

  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    allowNextLineBreakRef.current = event.key === "Enter" && event.shiftKey;
  };
}
