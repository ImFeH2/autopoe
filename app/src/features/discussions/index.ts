export {
  codePointOffsetToUtf16,
  codePointRangeToUtf16,
  isMentionBoundary,
  isMentionNameCharacter,
  normalizeMentionText,
} from "@/lib/mention-normalization";
export { DiscussionMarkdown } from "./discussion-markdown";
export {
  DiscussionForm,
  DiscussionsPage,
  discussionAgentStatus,
  discussionEntryAccessibleLabel,
  filterDiscussions,
  formatMessageCount,
  formatMessageTimestamp,
  humanUnreadForDiscussion,
  observeActivityBarHeight,
  positionInitialDiscussionMessages,
  preserveActivityBarScrollAnchor,
} from "./discussions-page";
export type { DraftMention, MentionQuery } from "./message-composer";
export {
  filterMentionAgents,
  findMentionQuery,
  getMentionKeyAction,
  insertDraftMention,
  mentionAgentScopeLabel,
  reconcileDraftMentions,
  shouldSubmitMessage,
} from "./message-composer";
