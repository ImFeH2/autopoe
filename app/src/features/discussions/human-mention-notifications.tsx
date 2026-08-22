export type HumanMentionNotificationItem = {
  discussionId: number;
  discussionTopic: string;
  messageId: number;
  senderName: string;
  unread: boolean;
};

type HumanMentionNotificationsProps = {
  notifications: HumanMentionNotificationItem[];
  onOpen: (discussionId: number, messageId: number) => void;
};

export function unreadHumanMentionCount(
  notifications: HumanMentionNotificationItem[],
): number {
  return notifications.filter((notification) => notification.unread).length;
}

export function HumanMentionNotifications({
  notifications,
  onOpen,
}: HumanMentionNotificationsProps) {
  return (
    <section
      aria-label="Human mention notifications"
      className="human-mention-notifications"
    >
      <header>
        <h2>Mentions</h2>
        <span>{unreadHumanMentionCount(notifications)} unread</span>
      </header>
      {notifications.length === 0 ? <p>No mentions.</p> : null}
      <ul className="human-mention-notification-list">
        {notifications.map((notification) => (
          <li key={`${notification.discussionId}-${notification.messageId}`}>
            <button
              className={notification.unread ? "is-unread" : undefined}
              type="button"
              aria-label={`Open mention from ${notification.senderName} in ${notification.discussionTopic}`}
              onClick={() =>
                onOpen(notification.discussionId, notification.messageId)
              }
            >
              <strong>{notification.senderName}</strong> in{" "}
              {notification.discussionTopic}
              {notification.unread ? " · Unread" : ""}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
