import { ImageAssetPreview } from "@/components/ImageAssetPreview";
import { MarkdownContent } from "@/components/MarkdownContent";
import { contentPartsToText, normalizeContentParts } from "@/lib/contentParts";
import { formatJsonOutput } from "@/lib/formatJsonOutput";
import { cn } from "@/lib/utils";
import type { ContentPart } from "@/types";

export interface AssistantComposerImage {
  id: string;
  previewUrl: string;
  name: string;
  width: number | null;
  height: number | null;
  status: "uploading" | "ready";
}

export interface AssistantRunningHintState {
  label: string;
  toolName?: string | null;
}

type RichContentLayout = "parts-order" | "human-attachments-top";

export function RichContentBlock({
  content,
  layout = "parts-order",
  parts,
  streaming,
  markdownClassName,
  preClassName,
}: {
  content: string | null | undefined;
  layout?: RichContentLayout;
  parts?: ContentPart[] | null;
  streaming?: boolean;
  markdownClassName?: string;
  preClassName?: string;
}) {
  const normalizedParts = normalizeContentParts(parts, content);
  const hasImagePart = normalizedParts.some((part) => part.type === "image");
  const textContent = contentPartsToText(normalizedParts, content);
  const formattedJson = formatJsonOutput(textContent);

  if (layout === "human-attachments-top" && hasImagePart) {
    const textParts = normalizedParts.filter(
      (part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text",
    );
    const imageParts = normalizedParts.filter(
      (part): part is Extract<ContentPart, { type: "image" }> =>
        part.type === "image",
    );

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2.5">
          {imageParts.map((part, index) => (
            <ImageAssetPreview
              key={`${index}-attachment-${part.asset_id}`}
              alt={part.alt}
              assetId={part.asset_id}
              compact
              height={part.height}
              mimeType={part.mime_type}
              width={part.width}
            />
          ))}
        </div>
        {textParts.length > 0 ? (
          <RichContentBlock
            content={contentPartsToText(textParts)}
            markdownClassName={markdownClassName}
            preClassName={preClassName}
            parts={textParts}
            streaming={streaming}
          />
        ) : null}
      </div>
    );
  }

  if (formattedJson) {
    return (
      <pre
        className={cn(
          "select-text whitespace-pre-wrap break-words rounded-xl border border-border bg-background/40 px-3.5 py-3 text-[11px] font-mono leading-relaxed text-foreground/80",
          preClassName,
        )}
      >
        <StreamingText text={formattedJson} streaming={streaming} />
      </pre>
    );
  }

  if (normalizedParts.length > 0 && hasImagePart) {
    return (
      <div className="space-y-3">
        {normalizedParts.map((part, index) =>
          part.type === "text" ? (
            <RichContentBlock
              key={`${index}-text`}
              content={part.text}
              markdownClassName={markdownClassName}
              preClassName={preClassName}
            />
          ) : (
            <ImageAssetPreview
              key={`${index}-image-${part.asset_id}`}
              alt={part.alt}
              assetId={part.asset_id}
              height={part.height}
              mimeType={part.mime_type}
              width={part.width}
            />
          ),
        )}
      </div>
    );
  }

  if (streaming) {
    return (
      <div
        className={cn(
          "min-w-0 select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
          markdownClassName,
        )}
      >
        <StreamingText text={textContent} streaming />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <MarkdownContent content={textContent} className={markdownClassName} />
    </div>
  );
}

function StreamingText({
  text,
  streaming,
}: {
  text: string | null | undefined;
  streaming?: boolean;
}) {
  return (
    <>
      {text}
      {streaming ? <span className="streaming-cursor" /> : null}
    </>
  );
}
