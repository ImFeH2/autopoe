import { getImageAssetUrl } from "@/lib/api";
import type {
  AssistantInputHistoryEntry,
  AssistantInputHistoryImage,
  ContentPart,
  PendingAssistantChatMessage,
  PendingSendChatMessage,
} from "@/types";

const SCROLL_BOTTOM_EPSILON = 10;

export interface DraftChatImage {
  id: string;
  assetId: string | null;
  previewUrl: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  name: string;
  status: "uploading" | "ready";
}

export function isScrolledToBottom(element: HTMLDivElement) {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return maxScrollTop - element.scrollTop <= SCROLL_BOTTOM_EPSILON;
}

export function createDraftImageId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`
  );
}

export function isReadyDraftImage(
  image: DraftChatImage,
): image is DraftChatImage & { assetId: string } {
  return image.status === "ready" && Boolean(image.assetId);
}

export function revokeDraftImageUrl(image: DraftChatImage) {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

export function revokeDraftImageUrls(images: DraftChatImage[]) {
  for (const image of images) {
    revokeDraftImageUrl(image);
  }
}

export function toInputHistoryImages(
  images: DraftChatImage[],
): AssistantInputHistoryImage[] {
  return images.filter(isReadyDraftImage).map((image) => ({
    assetId: image.assetId,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    name: image.name,
  }));
}

export function toDraftImagesFromHistory(
  entry: AssistantInputHistoryEntry,
): DraftChatImage[] {
  return entry.images.map((image, index) => ({
    id: `history-${entry.timestamp}-${index}`,
    assetId: image.assetId,
    previewUrl: getImageAssetUrl(image.assetId),
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    name: image.name,
    status: "ready",
  }));
}

export function draftImagesMatchHistoryEntry(
  images: DraftChatImage[],
  entry: AssistantInputHistoryEntry,
) {
  if (images.length !== entry.images.length) {
    return false;
  }

  return entry.images.every((image, index) => {
    const draft = images[index];

    return (
      Boolean(draft) &&
      draft?.status === "ready" &&
      draft.assetId === image.assetId &&
      draft.mimeType === image.mimeType &&
      draft.width === image.width &&
      draft.height === image.height &&
      draft.name === image.name
    );
  });
}

export function buildMessageParts(
  content: string,
  images: Array<DraftChatImage & { assetId: string }>,
): ContentPart[] {
  const parts: ContentPart[] = [];
  if (content) {
    parts.push({ type: "text", text: content });
  }
  for (const image of images) {
    parts.push({
      type: "image",
      asset_id: image.assetId,
      mime_type: image.mimeType,
      width: image.width,
      height: image.height,
      alt: image.name,
    });
  }
  return parts;
}

export function createPendingHumanMessage(
  content: string,
  parts: ContentPart[],
  timestamp: number,
): PendingAssistantChatMessage {
  return {
    id: `pending-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    type: "PendingHumanMessage",
    from: "human",
    content,
    parts,
    timestamp,
    message_id: null,
  };
}

export function createPendingSendMessage(input: {
  content: string;
  historyEntry: AssistantInputHistoryEntry;
  historyScope: string;
  parts: ContentPart[];
  targetId: string;
  targetState?: PendingSendChatMessage["target_state"];
  sendFailed?: boolean;
  timestamp: number;
}): PendingSendChatMessage {
  return {
    id: `pending-send-${input.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    type: "PendingSendMessage",
    from: "human",
    content: input.content,
    parts: input.parts,
    timestamp: input.timestamp,
    message_id: null,
    target_id: input.targetId,
    target_state: input.targetState ?? null,
    history_entry: input.historyEntry,
    history_entry_scope: input.historyScope,
    send_failed: input.sendFailed,
  };
}

export async function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      URL.revokeObjectURL(previewUrl);
      resolve(
        width > 0 && height > 0
          ? {
              width,
              height,
            }
          : null,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      resolve(null);
    };
    image.src = previewUrl;
  });
}

export async function createUploadingImageDrafts(files: File[]) {
  return Promise.all(
    files.map(async (file) => {
      const size = await readImageSize(file);
      return {
        id: createDraftImageId(),
        assetId: null,
        previewUrl: URL.createObjectURL(file),
        mimeType: file.type || null,
        width: size?.width ?? null,
        height: size?.height ?? null,
        name: file.name,
        status: "uploading" as const,
      } satisfies DraftChatImage;
    }),
  );
}
