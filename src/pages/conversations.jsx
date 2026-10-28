import React, { useEffect, useRef, useState, useCallback } from "react";
import { MessageSquare, Send, Plus, ArrowLeft } from "lucide-react";
import { useData } from "../hooks";
import { useLiveUpdates } from "../live-updates";
import { get, post } from "../api";
import { Button, PageHead, human } from "../components";
import "./conversations.css";

const fromHash = () => Number(location.hash.split("/")[1]) || null;
const roleLabel = (role) =>
  role === "SUPER_ADMIN" ? "School administrator" : human(role);
function messageKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // randomUUID requires HTTPS; getRandomValues also works on local HTTP portals.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function Thread({ id, user, onRead }) {
  const q = useData(`/messages/${id}`, null);
  const refresh = useCallback(q.reload, [id]);
  useLiveUpdates(refresh);
  const [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [older, setOlder] = useState([]),
    [more, setMore] = useState(null),
    [loadingOlder, setLoadingOlder] = useState(false);
  const pending = useRef(null),
    sending = useRef(false),
    readThrough = useRef(0),
    bottom = useRef(null);
  const thread = q.data?.conversation;
  const latest = q.data?.messages || [];
  const combined = [
    ...new Map([...older, ...latest].map((m) => [m.id, m])).values(),
  ].sort((a, b) => a.id - b.id);
  const lastId = latest.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lastId]);
  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const unread = latest
      .filter((m) => m.recipient_id === user.id && !m.read_at)
      .at(-1);
    if (!unread || unread.id <= readThrough.current) return;
    readThrough.current = unread.id;
    post(`/messages/${id}/read`, { through_id: unread.id })
      .then(() => {
        onRead();
        window.dispatchEvent(new Event("notices-read"));
      })
      .catch(() => {
        readThrough.current = 0;
      });
  }, [q.data, id, user.id]);
  async function send(e) {
    e.preventDefault();
    if (sending.current || !draft.trim()) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const body = draft.trim();
    try {
      if (pending.current?.body !== body)
        pending.current = { body, client_key: messageKey() };
      await post(`/messages/${id}/send`, pending.current);
      setDraft("");
      pending.current = null;
      refresh();
      onRead();
      window.dispatchEvent(new Event("notices-read"));
    } catch (e) {
      setError(`Message not sent. Your draft is still here. ${e.message}`);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="chat-thread" aria-label="Conversation">
      {q.error && (
        <p className="form-error" role="alert">
          {q.error}
        </p>
      )}
      {!q.data && !q.error && <p role="status">Loading conversation…</p>}
      {thread && (
        <>
          <header className="chat-heading">
            <strong>{thread.recipient_name}</strong>
            <span>
              {roleLabel(thread.recipient_role)} · {thread.student_name}
            </span>
            <small className={thread.online ? "chat-online" : ""}>
              {thread.online
                ? "Online now"
                : "Offline · messages will be waiting when they return"}
            </small>
          </header>
          <div
            className="chat-history"
            role="log"
            aria-label="Messages"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {(more ?? q.data.has_more) && (
              <Button
                secondary
                small
                disabled={loadingOlder}
                onClick={async () => {
                  setLoadingOlder(true);
                  setError("");
                  try {
                    const result = await get(
                      `/messages/${id}?before=${combined[0].id}`,
                    );
                    setOlder((current) => [...result.messages, ...current]);
                    setMore(result.has_more);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setLoadingOlder(false);
                  }
                }}
              >
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </Button>
            )}
            {!combined.length && (
              <p className="chat-empty">
                Start a conversation about {thread.student_name}.
              </p>
            )}
            {combined.map((m) => (
              <article
                key={m.id}
                className={`chat-bubble ${m.sender_id === user.id ? "is-mine" : ""}`}
              >
                <p>{m.body}</p>
                <small>
                  {new Date(m.created_at).toLocaleString()}{" "}
                  {m.sender_id === user.id && (
                    <> · {m.read_at ? "Read" : "Sent"}</>
                  )}
                </small>
              </article>
            ))}
            <div ref={bottom} />
          </div>
          <form className="chat-composer" onSubmit={send}>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <label htmlFor="chat-draft" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              rows={3}
              placeholder="Write a message…"
              disabled={busy}
            />
            <div>
              <small>{draft.length}/4000</small>
              <Button type="submit" disabled={busy || !draft.trim()}>
                <Send size={17} />
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

export function Conversations({ user }) {
  const q = useData("/messages"),
    contacts = useData("/messages/contacts");
  const refresh = useCallback(q.reload, []),
    refreshContacts = useCallback(contacts.reload, []);
  useLiveUpdates(refresh);
  useLiveUpdates(refreshContacts, 15000);
  const [active, setActive] = useState(fromHash),
    [newChat, setNewChat] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => {
      setActive(fromHash());
      setNewChat(false);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const choose = (id) => {
    setActive(id);
    setNewChat(false);
    location.hash = `conversations/${id}`;
  };
  return (
    <>
      <PageHead
        title="Messages"
        description={
          user.role === "PARENT"
            ? "Talk with your child's teachers, principal or school proprietor."
            : "Stay in touch with parents about their children."
        }
      />
      <div className={`chat-layout ${active && !newChat ? "has-active" : ""}`}>
        <aside className="chat-sidebar" aria-label="Conversations">
          <Button
            onClick={() => {
              setNewChat(true);
              setError("");
            }}
          >
            <Plus size={17} />
            New conversation
          </Button>
          {q.error && (
            <p className="form-error" role="alert">
              {q.error}
            </p>
          )}
          {!q.data.length && (
            <p className="chat-empty">No conversations yet.</p>
          )}
          {q.data.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`chat-contact ${active === t.id ? "is-active" : ""}`}
              onClick={() => choose(t.id)}
            >
              <strong>
                {t.recipient_name}
                {t.unread_count > 0 && (
                  <span
                    className="chat-count"
                    aria-label={`${t.unread_count} unread messages`}
                  >
                    {t.unread_count}
                  </span>
                )}
              </strong>
              <small>
                {t.student_name} · {roleLabel(t.recipient_role)}
              </small>
              <span>{t.last_message || "Start a conversation"}</span>
            </button>
          ))}
        </aside>
        <div className="chat-main">
          {active && !newChat && (
            <button
              className="text-button chat-back"
              type="button"
              onClick={() => {
                setActive(null);
                location.hash = "conversations";
              }}
            >
              <ArrowLeft size={17} />
              All conversations
            </button>
          )}
          {newChat ? (
            <section className="chat-new">
              <h2>Start a conversation</h2>
              <p>Choose a child and the person you want to message.</p>
              {contacts.error && (
                <p className="form-error" role="alert">
                  {contacts.error}
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <label>
                Child and recipient
                <select
                  disabled={busy}
                  value=""
                  onChange={async (e) => {
                    const contact = contacts.data[Number(e.target.value)];
                    if (!contact) return;
                    setBusy(true);
                    setError("");
                    try {
                      const thread = await post("/messages", {
                        student_id: contact.student_id,
                        recipient_id: contact.recipient_id,
                      });
                      refresh();
                      choose(thread.id);
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <option value="">Choose a recipient</option>
                  {contacts.data.map((c, i) => (
                    <option key={`${c.student_id}:${c.recipient_id}`} value={i}>
                      {c.student_name} — {c.recipient_name} (
                      {roleLabel(c.recipient_role)})
                    </option>
                  ))}
                </select>
              </label>
              {!contacts.loading &&
                !contacts.error &&
                !contacts.data.length && (
                  <p>
                    No contacts are available. Check that the child has an
                    active parent account and an assigned teacher or school
                    leader.
                  </p>
                )}
            </section>
          ) : active ? (
            <Thread key={active} id={active} user={user} onRead={refresh} />
          ) : (
            <div className="chat-placeholder">
              <MessageSquare size={38} />
              <h2>Your school conversations</h2>
              <p>
                Choose a conversation or start a new one. Messages stay saved
                when someone is offline.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
