import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryRecipient, Message } from "@/lib/backend";
import {
  DeliveryCircle,
  DeliveryPanel,
  deliverySummary,
  handleDeliveryPanelKeyDown,
  mentionVisualState,
} from "./message-delivery";

const recipients: DeliveryRecipient[] = [
  {
    member_id: 1,
    member_type_at_send: "human",
    member_name_at_send: "You",
    available: true,
    mentioned: true,
    read: true,
    ack: "pending",
  },
  {
    member_id: 2,
    member_type_at_send: "agent",
    member_name_at_send: "Ada",
    available: false,
    mentioned: false,
    read: null,
    ack: "not_applicable",
  },
];

const message: Message = {
  id: 7,
  sender_id: 3,
  body: "@You review",
  created_at: null,
  references: [],
  mentions: [],
  delivery: { recipients_known: false, recipients },
};

describe("message delivery", () => {
  it("distinguishes all token states without relying on color", () => {
    expect(mentionVisualState(undefined, false)).toBe("reference");
    expect(mentionVisualState({ ...recipients[0], read: false }, true)).toBe(
      "unread",
    );
    expect(mentionVisualState(recipients[0], true)).toBe("pending");
    expect(
      mentionVisualState({ ...recipients[0], read: null, ack: "acked" }, true),
    ).toBe("acked");
    expect(mentionVisualState(recipients[1], true)).toBe("unknown");
  });

  it("renders one keyboard button on the contracted message corner", () => {
    const other = renderToStaticMarkup(
      <DeliveryCircle
        isOwnMessage={false}
        message={message}
        onOpen={() => {}}
      />,
    );
    const own = renderToStaticMarkup(
      <DeliveryCircle isOwnMessage message={message} onOpen={() => {}} />,
    );
    expect(other).toContain("delivery-circle--right");
    expect(own).toContain("delivery-circle--left");
    expect(other).toContain('data-member-navigation-key="delivery:7:right"');
    expect(own).toContain('data-member-navigation-key="delivery:7:left"');
    expect(other).toContain("Read status unknown");
    expect(other).toContain(">?</span>");
  });

  it("shows explicit Human acknowledgement and identity actions", () => {
    expect(
      deliverySummary({
        ...message,
        delivery: {
          recipients_known: true,
          recipients: [{ ...recipients[0], read: true }],
        },
      }),
    ).toBe("Read 1/1");
    const markup = renderToStaticMarkup(
      <DeliveryPanel
        currentHumanMemberId={1}
        disabled={false}
        members={[{ id: 1, type: "human", name: "Owner" }]}
        message={message}
        onAcknowledge={() => {}}
        onClose={() => {}}
        onOpenMember={() => {}}
        returnTriggerKey="delivery:7:right"
        selectedMemberId={1}
      />,
    );
    expect(markup).toContain("Acknowledge mention");
    expect(markup).toContain("View member");
    expect(markup).toContain('data-return-trigger-key="delivery:7:right"');
    expect(markup).toContain("Awaiting acknowledgement");
    expect(markup).toContain('role="dialog"');
  });

  it("closes on Escape and wraps keyboard focus in both directions", () => {
    const first = { focus: vi.fn() } as unknown as HTMLElement;
    const last = { focus: vi.fn() } as unknown as HTMLElement;
    const preventDefault = vi.fn();
    const onClose = vi.fn();

    handleDeliveryPanelKeyDown(
      { key: "Escape", shiftKey: false, preventDefault },
      [first, last],
      first,
      onClose,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    preventDefault.mockClear();
    handleDeliveryPanelKeyDown(
      { key: "Tab", shiftKey: true, preventDefault },
      [first, last],
      first,
      onClose,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();

    preventDefault.mockClear();
    handleDeliveryPanelKeyDown(
      { key: "Tab", shiftKey: false, preventDefault },
      [first, last],
      last,
      onClose,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
  });
});
