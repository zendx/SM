import React, { useRef, useState } from "react";
import {
  Users,
  Search,
  Send,
  Check,
  CheckCircle2,
  Mail,
  GraduationCap,
  ArrowLeft,
} from "lucide-react";
import { useData } from "../hooks";
import { post } from "../api";
import { PageHead, Button, Modal } from "../components";
import "./parent-messages.css";

const plural = (n) => `${n} parent${n === 1 ? "" : "s"}`;
export function ParentMessages({ config, go }) {
  const parents = useData("/parent-messages/recipients");
  const [audience, setAudience] = useState("selected");
  const [selected, setSelected] = useState([]),
    [search, setSearch] = useState(""),
    [classId, setClassId] = useState("");
  const [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [sent, setSent] = useState(null);
  const sending = useRef(false);
  const recipients = parents.data || [];
  const classes = [
    ...new Map(
      recipients
        .flatMap((p) => p.children || [])
        .filter((c) => c.class_id)
        .map((c) => [String(c.class_id), c.class_name]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const chosen = recipients.filter(
    (p) =>
      audience === "all" ||
      (audience === "class"
        ? (p.children || []).some((c) => String(c.class_id) === classId)
        : selected.includes(p.id)),
  );
  const visible = recipients.filter((p) =>
    `${p.name} ${p.email} ${(p.children || []).map((c) => `${c.name} ${c.class_name || ""}`).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const ready =
    !parents.loading &&
    !parents.error &&
    chosen.length > 0 &&
    title.trim() &&
    body.trim();
  function toggle(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    );
  }
  async function send() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await post("/parent-messages", {
        recipient_ids: chosen.map((p) => p.id),
        title: title.trim(),
        body: body.trim(),
      });
      setSent({ count: result.count, title: title.trim() });
      setPreview(false);
      setTitle("");
      setBody("");
      setSelected([]);
      setAudience("selected");
      setClassId("");
      setSearch("");
    } catch (e) {
      setError(e.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="parent-messaging">
      <PageHead
        title="Message parents"
        description="Keep families informed, from a quick reminder to a school-wide update."
      />
      {sent && (
        <div className="pm-success" role="status">
          <CheckCircle2 size={22} />
          <div>
            <strong>Message sent to {plural(sent.count)}</strong>
            <p>
              {sent.title} — available in parent notifications. Email delivery
              will be attempted separately.
            </p>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => setSent(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {!preview && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {parents.error && (
        <div className="pm-load-error" role="alert">
          <p>We couldn't load your parent list. {parents.error}</p>
          <Button secondary onClick={parents.reload}>
            Try again
          </Button>
        </div>
      )}
      <form
        className="pm-layout"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) {
            setError("");
            setPreview(true);
          }
        }}
      >
        <aside className="pm-audience">
          <div className="pm-section-heading">
            <span className="pm-icon">
              <Users size={19} />
            </span>
            <div>
              <h2>Recipients</h2>
              <p>Who is this message for?</p>
            </div>
          </div>
          <fieldset
            className="pm-options"
            disabled={busy || parents.loading || !!parents.error}
          >
            <legend className="sr-only">Message audience</legend>
            {[
              [
                "all",
                "All parents",
                "Everyone with an active parent account",
                Users,
              ],
              [
                "class",
                "A class",
                "Parents of students in one class",
                GraduationCap,
              ],
              [
                "selected",
                "Choose parents",
                "Pick individual recipients",
                Mail,
              ],
            ].map(([value, label, description, Icon]) => (
              <label
                className={`pm-option ${audience === value ? "is-active" : ""}`}
                key={value}
              >
                <input
                  type="radio"
                  name="audience"
                  value={value}
                  checked={audience === value}
                  onChange={() => setAudience(value)}
                />
                <Icon size={18} />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {parents.loading ? (
            <p className="pm-muted" role="status">
              Loading parents…
            </p>
          ) : !parents.error && !recipients.length ? (
            <div className="pm-empty">
              <Users size={26} />
              <strong>No parent accounts yet</strong>
              <p>
                Link a parent account to a student to start sending updates.
              </p>
              {go && (
                <Button secondary type="button" onClick={() => go("students")}>
                  Open students
                </Button>
              )}
            </div>
          ) : (
            <>
              {audience === "all" && (
                <div className="pm-audience-note">
                  <CheckCircle2 size={18} />
                  <p>
                    All {plural(recipients.length)} will receive this message.
                  </p>
                </div>
              )}
              {audience === "class" && (
                <label className="pm-class-field">
                  Class
                  <select
                    aria-label="Class"
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                  >
                    <option value="">Choose a class</option>
                    {classes.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <small>
                    {classId
                      ? `${plural(chosen.length)} with children in this class`
                      : "Classes with linked parent accounts appear here."}
                  </small>
                </label>
              )}
              {audience === "selected" && (
                <div className="pm-picker">
                  <label className="pm-search">
                    <Search size={16} />
                    <span className="sr-only">Search parents</span>
                    <input
                      placeholder="Search parent, child or class"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <div className="pm-picker-toolbar">
                    <span aria-live="polite">{chosen.length} selected</span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!visible.length}
                      onClick={() =>
                        setSelected((current) => [
                          ...new Set([...current, ...visible.map((p) => p.id)]),
                        ])
                      }
                    >
                      Select {search ? "results" : "all"}
                    </button>
                    {selected.length > 0 && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setSelected([])}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="pm-parent-list">
                    {visible.map((p) => (
                      <label
                        key={p.id}
                        className={`pm-parent ${selected.includes(p.id) ? "is-selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                        <span className="pm-avatar" aria-hidden="true">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="pm-parent-info">
                          <strong>{p.name}</strong>
                          <small>
                            {(p.children || []).length
                              ? p.children
                                  .map(
                                    (c) =>
                                      `${c.name}${c.class_name ? ` · ${c.class_name}` : ""}`,
                                  )
                                  .join(", ")
                              : p.email}
                          </small>
                        </span>
                      </label>
                    ))}
                    {!visible.length && (
                      <div className="pm-empty">
                        <Search size={22} />
                        <strong>No parents found</strong>
                        <p>Try another name, child or class.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="pm-recipient-total">
            <span>Receiving this message</span>
            <strong aria-live="polite">{plural(chosen.length)}</strong>
          </div>
        </aside>
        <section className="pm-composer" aria-label="Compose message">
          <div className="pm-compose-head">
            <div>
              <h2>New message</h2>
              <p>From {config?.school?.name || "your school"}</p>
            </div>
            <span className="pm-channel">
              <Mail size={14} /> School update
            </span>
          </div>
          <div className="pm-compose-fields">
            <label className="pm-subject">
              Subject
              <input
                required
                maxLength={150}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What would you like parents to know?"
              />
            </label>
            <label className="pm-message">
              Message
              <textarea
                required
                maxLength={5000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message here. Include any dates, times or actions parents need to take."
              />
            </label>
            <div className="pm-word-count">
              {body.length.toLocaleString()} / 5,000 characters
            </div>
          </div>
          <div className="pm-compose-footer">
            <div>
              <span className="pm-footer-recipients">
                <Users size={15} />{" "}
                {chosen.length
                  ? `To ${plural(chosen.length)}`
                  : "Choose recipients to continue"}
              </span>
              <small>You'll review your message before sending.</small>
            </div>
            <Button type="submit" disabled={!ready || busy}>
              Review message <Send size={15} />
            </Button>
          </div>
          <div className="pm-delivery-note">
            <Check size={15} />
            <span>
              Delivered to parent notifications.{" "}
              {config?.smtp_configured
                ? "Also queued for email delivery."
                : "Set up school email in Administration to send email copies."}
            </span>
          </div>
        </section>
      </form>
      {preview && (
        <Modal
          title="Review message"
          onClose={() => {
            if (!busy) setPreview(false);
          }}
        >
          <div className="pm-review">
            <div className="pm-review-to">
              <Users size={18} />
              <div>
                <strong>To {plural(chosen.length)}</strong>
                <p>
                  {audience === "all"
                    ? "All parents"
                    : audience === "class"
                      ? classes.find(([id]) => id === classId)?.[1]
                      : chosen
                          .slice(0, 3)
                          .map((p) => p.name)
                          .join(", ") +
                        (chosen.length > 3
                          ? ` and ${chosen.length - 3} more`
                          : "")}
                </p>
              </div>
            </div>
            <div className="pm-review-message">
              <span>{config?.school?.name || "School update"}</span>
              <h3>{title.trim()}</h3>
              <p>{body.trim()}</p>
            </div>
            <p className="pm-muted">
              Each parent receives their own copy. Other recipients are kept
              private.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="pm-review-actions">
              <Button
                secondary
                disabled={busy}
                onClick={() => setPreview(false)}
              >
                <ArrowLeft size={15} /> Keep editing
              </Button>
              <Button disabled={busy} onClick={send}>
                <Send size={15} />
                {busy ? "Sending…" : `Send to ${plural(chosen.length)}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
