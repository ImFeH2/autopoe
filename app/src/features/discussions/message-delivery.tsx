import { type CSSProperties, useEffect, useRef } from "react";
import type { DeliveryRecipient, Member, Message } from "@/lib/backend";

export type DeliverySelection = {
  messageId: number;
  memberId?: number;
  triggerKey: string;
};

export function deliverySummary(message: Message): string {
  const delivery = message.delivery;
  if (!delivery?.recipients_known) return "Read status unknown";
  const read = delivery.recipients.filter((recipient) => recipient.read).length;
  return `Read ${read}/${delivery.recipients.length}`;
}

export function mentionVisualState(
  recipient: DeliveryRecipient | undefined,
  notified: boolean,
): "reference" | "unread" | "pending" | "acked" | "unknown" {
  if (!notified) return "reference";
  if (recipient?.ack === "acked") return "acked";
  if (!recipient?.available || recipient.read === null) return "unknown";
  if (recipient.read) return "pending";
  return "unread";
}

export function DeliveryCircle({
  isOwnMessage,
  message,
  onOpen,
}: {
  isOwnMessage: boolean;
  message: Message;
  onOpen: (selection: DeliverySelection) => void;
}) {
  const summary = deliverySummary(message);
  const delivery = message.delivery;
  const total = delivery?.recipients.length ?? 0;
  const read =
    delivery?.recipients.filter((recipient) => recipient.read).length ?? 0;
  const fraction =
    total > 0 ? read / total : delivery?.recipients_known ? 1 : 0;
  return (
    <button
      aria-label={`Message ${message.id} delivery. ${summary}`}
      className={`delivery-circle ${isOwnMessage ? "delivery-circle--left" : "delivery-circle--right"}`}
      onClick={(event) =>
        onOpen({
          messageId: message.id,
          triggerKey: `delivery:${message.id}:${event.currentTarget.dataset.side}`,
        })
      }
      data-delivery-trigger-key={`delivery:${message.id}:${isOwnMessage ? "left" : "right"}`}
      data-member-navigation-key={`delivery:${message.id}:${isOwnMessage ? "left" : "right"}`}
      data-side={isOwnMessage ? "left" : "right"}
      style={{ "--delivery-progress": `${fraction * 360}deg` } as CSSProperties}
      type="button"
    >
      <span aria-hidden="true">
        {delivery?.recipients_known ? `${read}/${total}` : "?"}
      </span>
    </button>
  );
}

function recipientName(recipient: DeliveryRecipient, members: Member[]) {
  return (
    members.find((member) => member.id === recipient.member_id)?.name ??
    recipient.member_name_at_send
  );
}

function recipientReadLabel(recipient: DeliveryRecipient) {
  if (recipient.read === null) return "Read unknown";
  return recipient.read ? "Read" : "Unread";
}

function recipientAckLabel(recipient: DeliveryRecipient) {
  if (!recipient.mentioned) return "Not mentioned";
  if (recipient.ack === "acked") return "Acknowledged";
  if (recipient.ack === "pending") return "Awaiting acknowledgement";
  return "Acknowledgement unknown";
}

export function handleDeliveryPanelKeyDown(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  focusable: HTMLElement[],
  activeElement: Element | null,
  onClose: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function DeliveryPanel({
  currentHumanMemberId,
  disabled,
  members,
  message,
  onAcknowledge,
  onClose,
  onOpenMember,
  returnTriggerKey,
  selectedMemberId,
}: {
  currentHumanMemberId: number;
  disabled: boolean;
  members: Member[];
  message: Message;
  onAcknowledge: (messageId: number) => void;
  onClose: () => void;
  onOpenMember: (memberId: number, triggerKey: string) => void;
  returnTriggerKey: string;
  selectedMemberId?: number;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      handleDeliveryPanelKeyDown(
        event,
        focusable,
        document.activeElement,
        onClose,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const recipients = (message.delivery?.recipients ?? []).filter(
    (recipient) =>
      selectedMemberId === undefined ||
      recipient.member_id === selectedMemberId,
  );
  const mentioned = recipients.filter((recipient) => recipient.mentioned);
  const acked = mentioned.filter(
    (recipient) => recipient.ack === "acked",
  ).length;
  return (
    <section
      aria-label={`Message ${message.id} delivery details`}
      aria-modal="true"
      className="delivery-panel"
      ref={panelRef}
      role="dialog"
    >
      <header>
        <strong>{deliverySummary(message)}</strong>
        {mentioned.length > 0 ? (
          <span>
            Acknowledged {acked}/{mentioned.length}
          </span>
        ) : null}
        <button
          aria-label="Close delivery details"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          ×
        </button>
      </header>
      {!message.delivery?.recipients_known ? (
        <p>Read status is unknown for this legacy message.</p>
      ) : null}
      <ul>
        {recipients.map((recipient) => {
          const name = recipientName(recipient, members);
          const canAcknowledge =
            recipient.member_id === currentHumanMemberId &&
            recipient.mentioned &&
            recipient.read === true &&
            recipient.ack === "pending";
          return (
            <li key={recipient.member_id}>
              <div>
                <strong>@{name}</strong>
                <span>
                  {recipient.member_type_at_send === "human"
                    ? "Human"
                    : "Agent"}
                  {recipient.available ? "" : " · Unavailable"}
                </span>
                <span>
                  {recipientReadLabel(recipient)} ·{" "}
                  {recipientAckLabel(recipient)}
                </span>
              </div>
              <div>
                {recipient.available ? (
                  <button
                    data-return-trigger-key={returnTriggerKey}
                    onClick={() =>
                      onOpenMember(recipient.member_id, returnTriggerKey)
                    }
                    type="button"
                  >
                    View member
                  </button>
                ) : null}
                {canAcknowledge ? (
                  <button
                    disabled={disabled}
                    onClick={() => onAcknowledge(message.id)}
                    type="button"
                  >
                    Acknowledge mention
                  </button>
                ) : recipient.member_id === currentHumanMemberId &&
                  recipient.ack === "acked" ? (
                  <span>Acknowledged ✓</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
