export type ReadableMember = {
  id: number;
  name: string;
};

export type ReadableDiscussion = {
  id: number;
  topic: string;
};

export type ReadableMentionReference = {
  member_id: number;
  name: string;
  deleted?: boolean;
};

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function discussionLabel(discussion: ReadableDiscussion | undefined) {
  if (!discussion) {
    return "Unavailable discussion";
  }
  return nonEmpty(discussion.topic) ?? "Untitled discussion";
}

export function senderLabel(
  senderId: number,
  members: readonly ReadableMember[],
  snapshotName?: string,
) {
  const current = members.find((candidate) => candidate.id === senderId);
  const currentName = nonEmpty(current?.name);
  if (currentName) {
    return currentName;
  }
  const snapshot = nonEmpty(snapshotName);
  return snapshot ? `${snapshot} (unavailable)` : "Unavailable sender";
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " image ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*~>_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shortMessageSummary(
  body: string,
  maxLength = 96,
  references: readonly ReadableMentionReference[] = [],
  members: readonly ReadableMember[] = [],
) {
  const currentBody = references.reduce((value, reference) => {
    if (reference.deleted) {
      return value;
    }
    const currentName = nonEmpty(
      members.find((member) => member.id === reference.member_id)?.name,
    );
    const snapshotName = nonEmpty(reference.name);
    if (!currentName || !snapshotName || currentName === snapshotName) {
      return value;
    }
    return value.split(`@${snapshotName}`).join(`@${currentName}`);
  }, body);
  const summary = stripMarkdown(currentBody);
  if (!summary) {
    return "No message content";
  }
  if (maxLength < 2) {
    return "…";
  }
  const characters = Array.from(summary);
  if (characters.length <= maxLength) {
    return summary;
  }
  return `${characters
    .slice(0, maxLength - 1)
    .join("")
    .trimEnd()}…`;
}
