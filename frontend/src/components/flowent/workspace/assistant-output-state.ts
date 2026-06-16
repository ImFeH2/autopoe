import type {
  AssistantOutputGroup,
  AssistantOutputItem,
  Message,
} from "@/components/flowent/types";

export function assistantOutputGroups(
  message: Message,
): AssistantOutputGroup[] {
  if (message.groups?.length) {
    return message.groups.filter((group) => group.items.length > 0);
  }

  if (message.items?.length) {
    return [
      {
        id: `${message.id}-items`,
        items: message.items,
      },
    ];
  }

  const toolItems: AssistantOutputItem[] = (message.tools ?? []).map(
    (tool) => ({
      id: `tool-${tool.id}`,
      tool,
      type: "tool",
    }),
  );
  const thinkingItem: AssistantOutputItem | null = message.thinking
    ? {
        content: message.thinking,
        id: `${message.id}-thinking`,
        isStreaming: message.isStreamingThinking,
        type: "thinking",
      }
    : null;
  const groups: AssistantOutputGroup[] = [];
  const processItems = [...(thinkingItem ? [thinkingItem] : []), ...toolItems];

  if (toolItems.length) {
    groups.push({
      id: `${message.id}-process`,
      items: processItems,
    });
  }

  if (message.content) {
    const contentItem: AssistantOutputItem = {
      content: message.content,
      id: `${message.id}-content`,
      type: "text",
    };
    if (toolItems.length) {
      groups.push({
        id: `${message.id}-content`,
        items: [contentItem],
      });
    } else {
      groups.push({
        id: `${message.id}-content`,
        items: [...processItems, contentItem],
      });
    }
  } else if (processItems.length && !toolItems.length) {
    groups.push({
      id: `${message.id}-process`,
      items: processItems,
    });
  }

  return groups;
}
