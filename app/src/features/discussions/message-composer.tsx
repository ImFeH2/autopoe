import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, MenuOption, Textarea } from "@/components/ui";
import type { Member, MentionSyntax } from "@/lib/backend";
import {
  isMentionBoundary,
  isMentionNameCharacter,
  looksLikeEmailAt,
  normalizeMentionText,
} from "@/lib/mention-normalization";

export { normalizeMentionText } from "@/lib/mention-normalization";

export type DraftMention = {
  end: number;
  label: string;
  start: number;
};

export type MentionQuery = {
  end: number;
  query: string;
  start: number;
};

export function shouldSubmitMessage({
  isComposing,
  key,
  shiftKey,
}: {
  isComposing: boolean;
  key: string;
  shiftKey: boolean;
}) {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function reconcileDraftMentions(
  previousBody: string,
  nextBody: string,
  mentions: DraftMention[],
): DraftMention[] {
  if (previousBody === nextBody) {
    return mentions;
  }

  let editStart = 0;
  while (
    editStart < previousBody.length &&
    editStart < nextBody.length &&
    previousBody[editStart] === nextBody[editStart]
  ) {
    editStart += 1;
  }

  let previousEditEnd = previousBody.length;
  let nextEditEnd = nextBody.length;
  while (
    previousEditEnd > editStart &&
    nextEditEnd > editStart &&
    previousBody[previousEditEnd - 1] === nextBody[nextEditEnd - 1]
  ) {
    previousEditEnd -= 1;
    nextEditEnd -= 1;
  }

  const offset = nextEditEnd - previousEditEnd;
  return mentions.flatMap((mention) => {
    let nextMention = mention;
    if (mention.end <= editStart) {
      nextMention = mention;
    } else if (mention.start >= previousEditEnd) {
      nextMention = {
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      };
    } else {
      return [];
    }

    const nextCharacter = nextBody[nextMention.end];
    return nextBody.slice(nextMention.start, nextMention.end) ===
      nextMention.label && isMentionBoundary(nextCharacter)
      ? [nextMention]
      : [];
  });
}

export function findMentionQuery(
  body: string,
  caret: number,
  mentions: DraftMention[],
): MentionQuery | null {
  if (caret < 0 || caret > body.length) {
    return null;
  }

  const beforeCaret = body.slice(0, caret);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0 || looksLikeEmailAt(body, start)) {
    return null;
  }

  const query = body.slice(start + 1, caret);
  if (
    /[\r\n@]/u.test(query) ||
    [...query].some((value) => !isMentionNameCharacter(value))
  ) {
    return null;
  }

  if (
    mentions.some(
      (mention) => mention.start === start && caret >= mention.start,
    )
  ) {
    return null;
  }

  return { end: caret, query, start };
}

type MentionMatch = {
  agent: Member;
  index: number;
  position: number;
  rank: number;
  spread: number;
};

function findOrderedMatch(value: string, query: string) {
  let queryIndex = 0;
  let start = -1;
  let end = -1;
  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }
    if (start < 0) {
      start = valueIndex;
    }
    end = valueIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      return { position: start, spread: end - start + 1 };
    }
  }
  return null;
}

function getMentionMatch(
  agent: Member,
  query: string,
  index: number,
): MentionMatch | null {
  const name = normalizeMentionText(agent.name);
  if (name === query) {
    return { agent, index, position: 0, rank: 0, spread: query.length };
  }
  if (name.startsWith(query)) {
    return { agent, index, position: 0, rank: 1, spread: query.length };
  }

  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const wordPosition = words.findIndex((word) => word.startsWith(query));
  if (wordPosition >= 0) {
    return {
      agent,
      index,
      position: wordPosition,
      rank: 2,
      spread: query.length,
    };
  }

  const substringPosition = name.indexOf(query);
  if (substringPosition >= 0) {
    return {
      agent,
      index,
      position: substringPosition,
      rank: 3,
      spread: query.length,
    };
  }

  const initials = words.map((word) => word[0]).join("");
  if (initials.startsWith(query)) {
    return { agent, index, position: 0, rank: 4, spread: query.length };
  }

  const orderedMatch = findOrderedMatch(name, query);
  return orderedMatch ? { agent, index, rank: 5, ...orderedMatch } : null;
}

export function mentionAgentScopeLabel(
  memberId: number,
  discussionMemberIds: number[],
): "In Discussion" | "Not in Discussion" {
  return discussionMemberIds.includes(memberId)
    ? "In Discussion"
    : "Not in Discussion";
}

export function mentionMemberMeta(
  member: Pick<Member, "id" | "type">,
  discussionMemberIds: number[],
): string {
  const typeLabel = member.type === "human" ? "Human" : "Agent";
  return `${typeLabel} · ${mentionAgentScopeLabel(
    member.id,
    discussionMemberIds,
  )}`;
}

export function mentionMemberAccessibleLabel(
  member: Pick<Member, "id" | "name" | "type">,
  discussionMemberIds: number[],
): string {
  return `Mention ${member.name}, ${mentionMemberMeta(
    member,
    discussionMemberIds,
  ).replace(" · ", ", ")}`;
}

export function filterMentionAgents(
  agents: Member[],
  query: string,
  currentHumanMemberId: number,
): Member[] {
  const mentionableMembers = agents.filter(
    (member) => member.id !== currentHumanMemberId,
  );
  const normalizedQuery = normalizeMentionText(query);
  if (!normalizedQuery) {
    return mentionableMembers;
  }
  return mentionableMembers
    .map((agent, index) => getMentionMatch(agent, normalizedQuery, index))
    .filter((match): match is MentionMatch => match !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.position - right.position ||
        left.spread - right.spread ||
        left.index - right.index,
    )
    .map((match) => match.agent);
}

export function insertDraftMention({
  agent,
  body,
  mentions,
  query,
}: {
  agent: Pick<Member, "name">;
  body: string;
  mentions: DraftMention[];
  query: MentionQuery;
}): { body: string; caret: number; mentions: DraftMention[] } {
  const label = `@${agent.name}`;
  const nextCharacter = body[query.end];
  const separator =
    nextCharacter === undefined || !isMentionBoundary(nextCharacter) ? " " : "";
  const nextBody = `${body.slice(0, query.start)}${label}${separator}${body.slice(query.end)}`;
  const nextMentions = reconcileDraftMentions(body, nextBody, mentions);
  const mention = {
    end: query.start + label.length,
    label,
    start: query.start,
  };

  return {
    body: nextBody,
    caret: mention.end + separator.length,
    mentions: [...nextMentions, mention].sort(
      (left, right) => left.start - right.start,
    ),
  };
}

type MentionKeyAction = "close" | "next" | "previous" | "select";

export function getMentionKeyAction({
  hasSuggestions,
  isComposing,
  key,
  open,
  shiftKey,
}: {
  hasSuggestions: boolean;
  isComposing: boolean;
  key: string;
  open: boolean;
  shiftKey: boolean;
}): MentionKeyAction | null {
  if (!open || isComposing) {
    return null;
  }
  if (key === "Escape") {
    return "close";
  }
  if (!hasSuggestions) {
    return null;
  }
  if (key === "ArrowDown") {
    return "next";
  }
  if (key === "ArrowUp") {
    return "previous";
  }
  if ((key === "Enter" || key === "Tab") && !shiftKey) {
    return "select";
  }
  return null;
}

type MessageComposerProps = {
  agents: Member[];
  body: string;
  disabled: boolean;
  currentHumanMemberId: number;
  discussionId: number;
  discussionMemberIds: number[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  mentions: DraftMention[];
  mentionSyntax: MentionSyntax;
  onChange: (body: string, mentions: DraftMention[]) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
};

export function MessageComposer({
  agents,
  body,
  currentHumanMemberId,
  disabled,
  discussionId,
  discussionMemberIds,
  inputRef,
  mentions,
  mentionSyntax,
  onChange,
  onSend,
}: MessageComposerProps) {
  const isComposingRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionCandidates =
    mentionQuery && mentionSyntax.enabled
      ? filterMentionAgents(agents, mentionQuery.query, currentHumanMemberId)
      : [];
  const resolvedMentionIndex = Math.min(
    activeMentionIndex,
    Math.max(mentionCandidates.length - 1, 0),
  );
  const activeMention = mentionCandidates[resolvedMentionIndex];
  const mentionMenuOpen = mentionQuery !== null && mentionCandidates.length > 0;
  const mentionListId = `mention-suggestions-${discussionId}`;
  const activeMentionId = activeMention
    ? `${mentionListId}-${activeMention.id}`
    : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    setMentionQuery(null);
    onSend(event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const mentionAction = getMentionKeyAction({
      hasSuggestions: mentionCandidates.length > 0,
      isComposing: event.nativeEvent.isComposing,
      key: event.key,
      open: mentionQuery !== null,
      shiftKey: event.shiftKey,
    });
    if (mentionAction) {
      event.preventDefault();
      if (mentionAction === "close") {
        setMentionQuery(null);
      } else if (mentionAction === "next") {
        setActiveMentionIndex(
          (current) => (current + 1) % mentionCandidates.length,
        );
      } else if (mentionAction === "previous") {
        setActiveMentionIndex(
          (current) =>
            (current - 1 + mentionCandidates.length) % mentionCandidates.length,
        );
      } else if (activeMention) {
        selectMention(activeMention);
      }
      return;
    }

    if (
      !shouldSubmitMessage({
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        shiftKey: event.shiftKey,
      })
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const input = event.currentTarget;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    const nextMentions = reconcileDraftMentions(body, input.value, mentions);
    onChange(input.value, nextMentions);
    updateMentionQuery(
      !isComposingRef.current && input.selectionStart === input.selectionEnd
        ? findMentionQuery(input.value, input.selectionStart, nextMentions)
        : null,
    );
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    setMentionQuery(null);
  }

  function handleCompositionEnd(event: SyntheticEvent<HTMLTextAreaElement>) {
    isComposingRef.current = false;
    updateMentionQueryFromInput(event.currentTarget);
  }

  function handleSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    if (!isComposingRef.current) {
      updateMentionQueryFromInput(event.currentTarget);
    }
  }

  function updateMentionQueryFromInput(input: HTMLTextAreaElement) {
    const nextMentions = reconcileDraftMentions(body, input.value, mentions);
    updateMentionQuery(
      input.selectionStart === input.selectionEnd
        ? findMentionQuery(input.value, input.selectionStart, nextMentions)
        : null,
    );
  }

  function updateMentionQuery(nextQuery: MentionQuery | null) {
    if (
      mentionQuery?.start !== nextQuery?.start ||
      mentionQuery?.end !== nextQuery?.end ||
      mentionQuery?.query !== nextQuery?.query
    ) {
      setActiveMentionIndex(0);
    }
    setMentionQuery(nextQuery);
  }

  function selectMention(agent: Member) {
    if (!mentionQuery || agent.id === currentHumanMemberId) {
      return;
    }
    const nextDraft = insertDraftMention({
      agent,
      body,
      mentions,
      query: mentionQuery,
    });
    onChange(nextDraft.body, nextDraft.mentions);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(nextDraft.caret, nextDraft.caret);
    });
  }

  useEffect(() => {
    const input = inputRef.current;
    if (input && body.length === 0) {
      input.style.height = "";
    }
  }, [body, inputRef]);

  useEffect(() => {
    if (!mentionSyntax.enabled) {
      setMentionQuery(null);
    }
  }, [mentionSyntax.enabled]);

  return (
    <form
      className="message-composer"
      aria-label="Send Message"
      onSubmit={handleSubmit}
    >
      {!mentionSyntax.enabled ? (
        <div className="mention-syntax-warning" role="status">
          <strong>Mentions are unavailable.</strong>
          <ul>
            {mentionSyntax.issues.map((issue) => (
              <li
                key={`${issue.code}-${issue.member_ids.join("-")}-${issue.names.join("-")}`}
              >
                {issue.code === "duplicate_name"
                  ? `Conflicting names: ${issue.names.join(", ")}`
                  : `Invalid name: ${issue.names.join(", ")}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="message-composer-row">
        <div className="message-composer-input">
          {mentionMenuOpen ? (
            <div
              aria-label="Members"
              className="mention-suggestions"
              id={mentionListId}
              role="listbox"
            >
              <ul role="none">
                {mentionCandidates.map((agent, index) => (
                  <li key={agent.id} role="none">
                    <MenuOption
                      aria-label={mentionMemberAccessibleLabel(
                        agent,
                        discussionMemberIds,
                      )}
                      id={`${mentionListId}-${agent.id}`}
                      label={`@${agent.name}`}
                      meta={mentionMemberMeta(agent, discussionMemberIds)}
                      onClick={() => selectMention(agent)}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveMentionIndex(index)}
                      selected={index === resolvedMentionIndex}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Textarea
            aria-activedescendant={activeMentionId}
            aria-autocomplete="list"
            aria-controls={mentionMenuOpen ? mentionListId : undefined}
            aria-expanded={mentionMenuOpen}
            aria-haspopup="listbox"
            aria-label="Message"
            autoFocus
            disabled={disabled}
            onBlur={() => setMentionQuery(null)}
            onChange={handleChange}
            onCompositionEnd={handleCompositionEnd}
            onCompositionStart={handleCompositionStart}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            placeholder="Write a message"
            ref={inputRef}
            required
            role="combobox"
            rows={1}
            value={body}
            variant="composer"
          />
        </div>
        <Button disabled={disabled} type="submit" variant="primary">
          Send
        </Button>
      </div>
    </form>
  );
}
