import {
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { type AssistantComposerImage } from "@/components/assistant/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useImageViewer } from "@/context/imageViewer";
import {
  insertAssistantCommand,
  isAssistantCommandReadyToSend,
  parseAssistantCommandInput,
  resolveAssistantCommandSelection,
  stepAssistantCommandSelection,
  type AssistantCommandSpec,
} from "@/lib/assistantCommands";
import { cn } from "@/lib/utils";

interface AssistantChatComposerProps {
  busy?: boolean;
  commandsEnabled?: boolean;
  disabled: boolean;
  images?: AssistantComposerImage[];
  imageInputEnabled?: boolean;
  input: string;
  onAddImages?: (files: FileList | File[]) => void;
  onChange: (value: string) => void;
  onNavigateHistory?: (
    direction: -1 | 1,
    selection: {
      start: number | null;
      end: number | null;
    },
  ) => boolean;
  suppressCommandNavigation?: boolean;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onRemoveImage?: (imageId: string) => void;
  onSend: () => void;
  onStop?: () => void;
  overlay?: boolean;
  targetLabel?: string;
  stopping?: boolean;
}

export function AssistantChatComposer({
  busy = false,
  commandsEnabled = true,
  disabled,
  images = [],
  imageInputEnabled = true,
  input,
  onAddImages = () => {},
  onChange,
  onNavigateHistory,
  onKeyDown,
  onRemoveImage = () => {},
  onSend,
  onStop,
  overlay = false,
  targetLabel = "Assistant",
  stopping = false,
  suppressCommandNavigation = false,
}: AssistantChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionLabel = busy ? (stopping ? "Stopping..." : "Stop") : "Send";
  const actionDisabled = busy ? stopping || !onStop : disabled;
  const {
    filtered: commandOptions,
    isCommandInput,
    token: commandToken,
  } = commandsEnabled
    ? parseAssistantCommandInput(input)
    : { filtered: [], isCommandInput: false, token: "" };
  const [selectedCommandState, setSelectedCommandState] = useState<{
    index: number;
    token: string;
  }>({ index: 0, token: "" });
  const [dismissedCommandToken, setDismissedCommandToken] = useState<
    string | null
  >(null);
  const commandPanelVisible =
    commandsEnabled &&
    images.length === 0 &&
    isCommandInput &&
    dismissedCommandToken !== commandToken;
  const { selectedCommand, selectedCommandIndex } =
    resolveAssistantCommandSelection(
      commandOptions,
      selectedCommandState,
      commandToken,
    );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const minHeight = lineHeight + paddingTop + paddingBottom;
    const maxHeight = lineHeight * 8 + paddingTop + paddingBottom;

    textarea.style.height = "0px";

    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight,
    );

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  const handleInputChange = (nextValue: string) => {
    const nextCommandInput = commandsEnabled
      ? parseAssistantCommandInput(nextValue)
      : { isCommandInput: false, token: "" };

    if (!nextCommandInput.isCommandInput) {
      setDismissedCommandToken(null);
      setSelectedCommandState({ index: 0, token: "" });
    } else if (nextCommandInput.token !== commandToken) {
      setSelectedCommandState({ index: 0, token: nextCommandInput.token });
      if (
        dismissedCommandToken &&
        dismissedCommandToken !== nextCommandInput.token
      ) {
        setDismissedCommandToken(null);
      }
    }

    onChange(nextValue);
  };

  const selectCommand = (command: AssistantCommandSpec) => {
    onChange(insertAssistantCommand(input, command));
    setSelectedCommandState({ index: 0, token: command.name });
    setDismissedCommandToken(null);
    textareaRef.current?.focus();
  };

  const resetCommandState = () => {
    setDismissedCommandToken(null);
    setSelectedCommandState({ index: 0, token: "" });
  };

  const handleComposerKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      onNavigateHistory
    ) {
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const handled = onNavigateHistory(direction, {
        start: event.currentTarget.selectionStart,
        end: event.currentTarget.selectionEnd,
      });

      if (handled) {
        event.preventDefault();
        return;
      }
    }

    if (
      suppressCommandNavigation &&
      commandPanelVisible &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      onKeyDown(event);
      return;
    }

    if (commandPanelVisible) {
      const completionCommand =
        commandOptions.length > 0 &&
        selectedCommand &&
        !isAssistantCommandReadyToSend(input, selectedCommand.name)
          ? selectedCommand
          : null;

      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedCommandToken(commandToken);
        return;
      }

      if (commandOptions.length > 0 && event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedCommandState(
          stepAssistantCommandSelection(
            commandOptions,
            selectedCommandState,
            commandToken,
            1,
          ),
        );
        return;
      }

      if (commandOptions.length > 0 && event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedCommandState(
          stepAssistantCommandSelection(
            commandOptions,
            selectedCommandState,
            commandToken,
            -1,
          ),
        );
        return;
      }

      if (completionCommand && event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        selectCommand(completionCommand);
        return;
      }

      if (completionCommand && event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        selectCommand(completionCommand);
        return;
      }
    }

    onKeyDown(event);
  };

  const handleComposerPaste: ClipboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    const pastedImages = getClipboardImageFiles(event.clipboardData?.items);
    if (pastedImages.length === 0 || !imageInputEnabled) {
      return;
    }

    event.preventDefault();
    resetCommandState();
    onAddImages(pastedImages);
  };

  return (
    <div
      className={cn(
        overlay ? "w-full pointer-events-auto" : "border-t border-border p-2.5",
      )}
    >
      {commandPanelVisible ? (
        <div
          role="listbox"
          aria-label="Available commands"
          className="pointer-events-auto mb-2 overflow-hidden rounded-xl border border-border bg-surface-overlay shadow-sm"
        >
          {commandOptions.length > 0 ? (
            commandOptions.map((command, index) => {
              const selected = index === selectedCommandIndex;
              return (
                <Button
                  key={command.name}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectCommand(command);
                  }}
                  className={cn(
                    "h-auto w-full items-start justify-start gap-3 rounded-none px-3 py-2.5 text-left whitespace-normal transition-colors",
                    selected
                      ? "bg-accent/60 hover:bg-accent/60"
                      : "hover:bg-accent/35",
                  )}
                >
                  <span className="mt-0.5 shrink-0 rounded-full border border-border bg-accent/45 px-2 py-0.5 font-mono text-[11px] text-foreground">
                    {command.name}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-foreground">
                      {command.description}
                    </span>
                    <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                      {command.usage}
                    </span>
                  </span>
                </Button>
              );
            })
          ) : (
            <div className="px-3 py-3 text-[12px] text-muted-foreground">
              No matching commands.
            </div>
          )}
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-background/30 px-2 py-1 shadow-sm transition-[border-color,background-color,box-shadow] duration-200 hover:border-ring/35 focus-within:border-ring/45 focus-within:ring-[3px] focus-within:ring-ring/35">
        {images.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-border px-0.5 py-2">
            {images.map((image) => (
              <PendingImagePreviewTile
                key={image.id}
                image={image}
                onRemove={() => onRemoveImage(image.id)}
              />
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1">
          <Input
            ref={fileInputRef}
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            multiple
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                resetCommandState();
                onAddImages(event.target.files);
              }
              event.currentTarget.value = "";
            }}
            type="file"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              imageInputEnabled
                ? "Add images"
                : "Current model does not support image input"
            }
            disabled={!imageInputEnabled}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "shrink-0 rounded-full transition-colors disabled:opacity-35",
              imageInputEnabled
                ? "bg-accent/55 text-foreground hover:bg-accent"
                : "bg-accent/20 text-muted-foreground",
            )}
          >
            <ImagePlus className="size-4" />
          </Button>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onPaste={handleComposerPaste}
            placeholder={
              commandsEnabled
                ? `Message ${targetLabel} or type / for commands`
                : `Message ${targetLabel}`
            }
            rows={1}
            className={cn(
              "min-h-5 w-full resize-none self-center border-0 bg-transparent px-0.5 py-0 text-[13px] leading-5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0",
              "rounded-sm",
              input.length === 0 && "truncate",
            )}
          />
          <Button
            type="button"
            variant={!busy ? "default" : "ghost"}
            size="sm"
            onClick={busy ? onStop : onSend}
            disabled={actionDisabled}
            aria-label={
              busy ? `Stop ${targetLabel}` : `Send ${targetLabel} message`
            }
            className={cn(
              "shrink-0 rounded-full transition-all duration-300 active:scale-[0.96] disabled:opacity-30",
              "h-8 gap-1.5 px-3.5",
              busy
                ? "bg-destructive/18 text-destructive hover:bg-destructive/24"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {busy ? (
              <Square className="size-3.5 fill-current" strokeWidth={2.4} />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.5} />
            )}
            <span className="text-[11px] font-medium">{actionLabel}</span>
          </Button>
        </div>
      </div>
      {!imageInputEnabled ? (
        <div className="px-1.5 pt-2 text-[11px] text-muted-foreground">
          Current model does not support image input.
        </div>
      ) : null}
    </div>
  );
}

function getClipboardImageFiles(
  items: DataTransferItemList | null | undefined,
): File[] {
  if (!items) {
    return [];
  }

  return Array.from(items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
}

function PendingImagePreviewTile({
  image,
  onRemove,
}: {
  image: AssistantComposerImage;
  onRemove: () => void;
}) {
  const { openImage } = useImageViewer();
  const meta =
    image.status === "uploading"
      ? "Uploading..."
      : image.width && image.height
        ? `${image.width}x${image.height}`
        : "Ready";

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-background/35 transition-colors hover:border-ring/35">
      <Button
        aria-label={`Preview ${image.name}`}
        type="button"
        variant="ghost"
        className="h-auto w-auto items-start justify-start rounded-none p-0 text-left hover:bg-transparent hover:text-inherit"
        onClick={() =>
          openImage({
            src: image.previewUrl,
            alt: image.name,
            meta,
            width: image.width,
            height: image.height,
          })
        }
      >
        <img
          alt={image.name}
          className="h-20 w-20 object-cover"
          src={image.previewUrl}
        />
        <div className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-[10px] text-foreground/84">
          <div className="truncate">{image.name}</div>
          <div className="text-muted-foreground">{meta}</div>
        </div>
      </Button>
      <Button
        aria-label={`Remove ${image.name}`}
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 top-1 z-10 rounded-full bg-background/72 text-muted-foreground hover:bg-background/90 hover:text-foreground"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
