import React from "react";
import { Modal } from "./components";
import { notificationHtml, notificationLink } from "./notification-content";
import "./notification-reader.css";

export function NotificationReader({ notice, onClose }) {
  const link = notificationLink(notice.link);
  return (
    <Modal title={notice.title} onClose={onClose}>
      <article className="notification-reader">
        <div className="notification-reader-meta">
          <span>
            {notice.source === "school" ? "School update" : "Notification"}
          </span>
          <time dateTime={notice.created_at}>
            {new Date(notice.created_at).toLocaleString()}
          </time>
        </div>
        <div
          className="notification-reader-body"
          dangerouslySetInnerHTML={{ __html: notificationHtml(notice.body) }}
        />
        {link && !new URL(link).hash.startsWith("#notifications") && (
          <a className="btn secondary" href={link}>
            Open related activity
          </a>
        )}
      </article>
    </Modal>
  );
}
