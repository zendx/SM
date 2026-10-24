import React, { useState } from "react";
import { useData } from "../hooks";
import { post } from "../api";
import { PageHead, Panel, Button } from "../components";
export function ParentMessages() {
  const parents = useData("/parent-messages/recipients");
  const [selected, setSelected] = useState([]),
    [search, setSearch] = useState("");
  const [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const recipients = parents.data || [];
  const visible = recipients.filter((p) =>
    `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  async function send() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post("/parent-messages", {
        recipient_ids: selected,
        title,
        body,
      });
      setMessage(result.message);
      setPreview(false);
      setTitle("");
      setBody("");
      setSelected([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        title="Message parents"
        description="Send school updates to parents. Messages appear in their Notifications and are queued for email delivery."
      />
      {(error || parents.error) && (
        <p className="form-error" role="alert">
          {error || parents.error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPreview(true);
            setMessage("");
          }}
        >
          <h3>1. Choose parents</h3>
          <p>Only active parent accounts in your school are listed.</p>
          <label>
            Find a parent
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              disabled={busy}
            />
          </label>
          <div className="actions">
            <Button
              secondary
              type="button"
              disabled={busy || !recipients.length}
              onClick={() => {
                setSelected(recipients.map((p) => p.id));
                setPreview(false);
              }}
            >
              Select all parents
            </Button>
            <Button
              secondary
              type="button"
              disabled={busy}
              onClick={() => {
                setSelected([]);
                setPreview(false);
              }}
            >
              Clear selection
            </Button>
          </div>
          <p aria-live="polite">
            {selected.length} parent{selected.length === 1 ? "" : "s"} selected
          </p>
          <div style={{ maxHeight: 260, overflowY: "auto", marginBottom: 20 }}>
            {visible.map((p) => (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 8,
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={selected.includes(p.id)}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? [...selected, p.id]
                        : selected.filter((id) => id !== p.id),
                    );
                    setPreview(false);
                  }}
                />
                <span>
                  {p.name} <small>{p.email}</small>
                </span>
              </label>
            ))}
            {!visible.length && (
              <p>
                {parents.loading
                  ? "Loading parents…"
                  : "No matching parents. Parent accounts can be linked from student records."}
              </p>
            )}
          </div>
          <h3>2. Write your message</h3>
          <label>
            Subject
            <input
              required
              maxLength={150}
              value={title}
              disabled={busy}
              onChange={(e) => {
                setTitle(e.target.value);
                setPreview(false);
              }}
              placeholder="For example: Parent meeting on Friday"
            />
          </label>
          <label>
            Message
            <textarea
              required
              maxLength={5000}
              rows={7}
              value={body}
              disabled={busy}
              onChange={(e) => {
                setBody(e.target.value);
                setPreview(false);
              }}
              placeholder="Write the details parents need to know…"
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !selected.length || !title.trim() || !body.trim()}
          >
            Review message
          </Button>
        </form>
      </Panel>
      {preview && (
        <Panel>
          <h3>3. Review and send</h3>
          <p>
            To: {selected.length} parent{selected.length === 1 ? "" : "s"}
          </p>
          <strong>{title}</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{body}</p>
          <Button disabled={busy} onClick={send}>
            {busy
              ? "Sending…"
              : `Send to ${selected.length} parent${selected.length === 1 ? "" : "s"}`}
          </Button>
        </Panel>
      )}
    </>
  );
}
