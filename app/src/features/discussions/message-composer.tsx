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
import type { AgentMember } from "@/lib/backend";

export type DraftMention = {
  end: number;
  label: string;
  memberId: number;
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

export function getDraftMentionIds(mentions: DraftMention[]): number[] {
  return [...new Set(mentions.map((mention) => mention.memberId))];
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

    return nextBody.slice(nextMention.start, nextMention.end) ===
      nextMention.label
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
  if (start < 0) {
    return null;
  }

  const precedingCharacter = start > 0 ? body[start - 1] : undefined;
  if (precedingCharacter && !/[\s([{]/u.test(precedingCharacter)) {
    return null;
  }

  const query = body.slice(start + 1, caret);
  if (/[\r\n@]/u.test(query)) {
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

export function filterMentionAgents(
  agents: AgentMember[],
  query: string,
): AgentMember[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return agents;
  }
  return agents.filter((agent) =>
    agent.name.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function insertDraftMention({
  agent,
  body,
  mentions,
  query,
}: {
  agent: Pick<AgentMember, "id" | "name">;
  body: string;
  mentions: DraftMention[];
  query: MentionQuery;
}): { body: string; caret: number; mentions: DraftMention[] } {
  const label = `@${agent.name}`;
  const nextCharacter = body[query.end];
  const separator =
    nextCharacter && /[\s.,!?;:)\]}]/u.test(nextCharacter) ? "" : " ";
  const nextBody = `${body.slice(0, query.start)}${label}${separator}${body.slice(query.end)}`;
  const nextMentions = reconcileDraftMentions(body, nextBody, mentions);
  const mention = {
    end: query.start + label.length,
    label,
    memberId: agent.id,
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
  agents: AgentMember[];
  body: string;
  disabled: boolean;
  discussionId: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  mentions: DraftMention[];
  onChange: (body: string, mentions: DraftMention[]) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
};

export function MessageComposer({
  agents,
  body,
  disabled,
  discussionId,
  inputRef,
  mentions,
  onChange,
  onSend,
}: MessageComposerProps) {
  const isComposingRef = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionCandidates = mentionQuery
    ? filterMentionAgents(agents, mentionQuery.query)
    : [];
  const resolvedMentionIndex = Math.min(
    activeMentionIndex,
    Math.max(mentionCandidates.length - 1, 0),
  );
  const activeMention = mentionCandidates[resolvedMentionIndex];
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

  function selectMention(agent: AgentMember) {
    if (!mentionQuery) {
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

  return (
    <form
      className="message-composer"
      aria-label="Send Message"
      onSubmit={handleSubmit}
    >
      <div className="message-composer-row">
        <div className="message-composer-input">
          {mentionQuery ? (
            <div
              aria-label="Agents"
              className="mention-suggestions"
              id={mentionListId}
              role="listbox"
            >
              {mentionCandidates.length > 0 ? (
                <ul role="none">
                  {mentionCandidates.map((agent, index) => (
                    <li key={agent.id} role="none">
                      <MenuOption
                        aria-label={`Mention ${agent.name}`}
                        id={`${mentionListId}-${agent.id}`}
                        label={`@${agent.name}`}
                        meta="Agent"
                        onClick={() => selectMention(agent)}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveMentionIndex(index)}
                        selected={index === resolvedMentionIndex}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mention-suggestions-empty" role="status">
                  No matching Agents
                </p>
              )}
            </div>
          ) : null}
          <Textarea
            aria-activedescendant={activeMentionId}
            aria-autocomplete="list"
            aria-controls={mentionQuery ? mentionListId : undefined}
            aria-expanded={mentionQuery !== null}
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
