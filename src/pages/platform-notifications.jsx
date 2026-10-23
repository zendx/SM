import React, { useEffect, useState } from "react";
import { EmailDeliveryStatus } from "./email-delivery";
import { Bell } from "lucide-react";
import { useData } from "../hooks";
import { post } from "../api";
import { Panel, Form, Button, Table } from "../components";
import { ContactPreferences } from "./communication-preferences";

export function NotificationBell({ onClick }) {
  const q = useData("/subscription/notices/unread-count", { count: 0 });
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "visible") return;
      post("/subscription/notices/presence", {}).catch(() => {});
      q.reload();
    };
    update();
    const timer = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("notices-read", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("notices-read", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  const unread = Number(q.data?.count || 0);
  return (
    <button
      className={`icon-btn notification-button${unread > 0 ? " has-unread" : ""}`}
      title={unread > 0 ? `${unread} unread notifications` : "Notifications"}
      aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      onClick={onClick}
    >
      <Bell size={20} />
      {unread > 0 && (
        <span className="notification-count" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
export function PlatformInbox() {
  const q = useData("/subscription/notices");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(q.reload, 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <ContactPreferences />
      <Panel
        title="SMPIS inbox"
        description="Announcements and support updates are also queued for email, even when you are online or have read them here."
        action={
          <Button
            small
            secondary
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await post("/subscription/notices/read-all", {});
                q.reload();
                window.dispatchEvent(new Event("notices-read"));
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark all as read
          </Button>
        }
      >
        {error && <p className="form-error">{error}</p>}
        {q.error && <p className="form-error">{q.error}</p>}
        <Table
          rows={q.data}
          columns={[
            {
              label: "Notification",
              render: (n) => (
                <div>
                  <strong>{n.title}</strong>
                  <p className="support-description">{n.body}</p>
                  <small>{new Date(n.created_at).toLocaleString()}</small>
                </div>
              ),
            },
            { label: "Status", render: (n) => (n.read_at ? "Read" : "Unread") },
            {
              label: "Actions",
              render: (n) => (
                <div className="toolbar">
                  <a
                    href={n.link}
                    onClick={async (event) => {
                      event.preventDefault();
                      await post(`/subscription/notices/${n.id}/read`, {});
                      location.assign(n.link);
                    }}
                  >
                    Open
                  </a>
                  {!n.read_at && (
                    <Button
                      small
                      secondary
                      onClick={async () => {
                        await post(`/subscription/notices/${n.id}/read`, {});
                        q.reload();
                        window.dispatchEvent(new Event("notices-read"));
                      }}
                    >
                      Mark as read
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
export function OwnerCommunications() {
  const q = useData("/saas/owner/contacts"),
    [selected, setSelected] = useState([]),
    [message, setMessage] = useState("");
  return (
    <>
      <EmailDeliveryStatus />
      <Panel
        title="Tenant contacts"
        description="School administrator email addresses and registration phone numbers."
        action={
          <div className="toolbar">
            <a
              className="btn secondary"
              href="/api/v1/saas/owner/contacts?format=csv"
            >
              Export tenant contacts
            </a>
            <a
              className="btn secondary"
              href="/api/v1/saas/owner/contacts?format=csv&marketing=email"
            >
              Export newsletter opt-ins
            </a>
            <a
              className="btn secondary"
              href="/api/v1/saas/owner/contacts?format=csv&marketing=phone"
            >
              Export phone opt-ins
            </a>
          </div>
        }
      >
        {q.error && <p className="form-error">{q.error}</p>}
        <Table
          rows={q.data}
          columns={[
            {
              label: "Select",
              render: (c) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${c.school_name}`}
                  checked={selected.includes(c.school_id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...new Set([...selected, c.school_id])]
                        : selected.filter((id) => id !== c.school_id),
                    )
                  }
                />
              ),
            },
            { label: "School", key: "school_name" },
            { label: "Administrator", key: "name" },
            { label: "Email", key: "email" },
            { label: "Phone", key: "phone_number" },
            {
              label: "Email promotions",
              render: (c) =>
                c.marketing_email_consent ? "Opted in" : "Not opted in",
            },
            {
              label: "Phone promotions",
              render: (c) =>
                c.marketing_phone_consent ? "Opted in" : "Not opted in",
            },
            { label: "Status", key: "status" },
          ]}
        />
      </Panel>
      <Panel
        title="Send tenant notification"
        description="Service messages reach eligible administrators by inbox and email. Promotional newsletters reach only email opt-ins and include an unsubscribe link. Reading a message or being online does not cancel its email."
      >
        <p>{selected.length} school(s) selected.</p>
        {message && <p className="notice">{message}</p>}
        <Form
          fields={[
            {
              name: "message_kind",
              label: "Message type",
              wide: true,
              default: "SERVICE",
              options: [
                { value: "SERVICE", label: "Account or service notification" },
                {
                  value: "PROMOTIONAL",
                  label: "Promotional email newsletter (opt-ins only)",
                },
              ],
            },
            {
              name: "audience",
              label: "Recipients",
              options: [
                { value: "SELECTED", label: "Selected schools" },
                { value: "ALL", label: "All eligible schools" },
              ],
              default: "SELECTED",
              wide: true,
            },
            {
              name: "title",
              label: "Notification subject",
              wide: true,
              maxLength: 200,
            },
            {
              name: "body",
              label: "Notification message",
              type: "textarea",
              wide: true,
            },
          ]}
          submit="Send notification"
          onSubmit={async (v) => {
            const result = await post("/saas/owner/notifications", {
              ...v,
              school_ids: selected,
            });
            setMessage(result.message);
          }}
        />
      </Panel>
    </>
  );
}
