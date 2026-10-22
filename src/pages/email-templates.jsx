import React, { useState } from "react";
import { useData } from "../hooks";
import { patch, post } from "../api";
import { Panel, Button, Modal, Loading, Empty } from "../components";
import { OnboardingEmails } from "./onboarding-emails";

const groups = [
  {
    name: "Account & security",
    description: "Account invitations, verification and sign-in help.",
    keys: ["account_created", "verification", "password_reset", "mfa_reminder"],
  },
  {
    name: "Subscription & billing",
    description: "Renewal reminders and automatic payment updates.",
    keys: ["subscription_reminder", "auto_renewal_failed"],
  },
  {
    name: "Support",
    description:
      "Support replies and alerts for the owner and department teams.",
    keys: ["support_reply", "support_received"],
  },
  {
    name: "School communications",
    description: "Announcements, school alerts and promotional messages.",
    keys: [],
  },
];

function TemplateEditor({ template, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    subject: template.subject,
    body: template.body,
  });
  const [preview, setPreview] = useState(null);
  const [previewDraft, setPreviewDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function showPreview() {
    setBusy("preview");
    setError("");
    try {
      setPreview(
        await post(
          `/saas/owner/email-templates/${template.key}/preview`,
          draft,
        ),
      );
      setPreviewDraft(JSON.stringify(draft));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal
      title={template.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        Edit the subject and message, then preview the branded email before
        saving.
      </p>
      <form
        className="email-template-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy("save");
          setError("");
          try {
            await patch(`/saas/owner/email-templates/${template.key}`, draft);
            onSaved();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy("");
          }
        }}
      >
        <label className="field">
          <span>Email subject</span>
          <input
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            required
            maxLength={200}
          />
        </label>
        <label className="field">
          <span>Email message template</span>
          <textarea
            rows={10}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            required
            maxLength={10000}
          />
        </label>
        <div className="email-template-placeholders">
          <strong>Available placeholders</strong>
          <div>
            {template.variables.map((variable) => (
              <code key={variable}>{`{{${variable}}}`}</code>
            ))}
          </div>
          <small>
            Keep the link placeholder where available. Notification and reminder
            messages must also include the body placeholder.
          </small>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="email-template-actions">
          <Button
            type="button"
            secondary
            disabled={!!busy}
            onClick={showPreview}
          >
            {busy === "preview" ? "Preparing preview…" : "Preview draft"}
          </Button>
          <Button type="submit" disabled={!!busy}>
            {busy === "save" ? "Saving…" : "Save email template"}
          </Button>
        </div>
      </form>
      {preview && (
        <section
          className="email-template-preview"
          aria-label="Draft email preview"
        >
          <h3>Email preview</h3>
          <p className="muted">
            Sample recipient details are shown. Previewing does not save or send
            this email.
          </p>
          {previewDraft !== JSON.stringify(draft) && (
            <p className="notice" role="status">
              Your draft has changed. Select Preview draft to refresh this
              preview.
            </p>
          )}
          <p className="email-template-preview-subject">
            <strong>Subject:</strong> {preview.subject}
          </p>
          <iframe
            title="Email template HTML preview"
            sandbox=""
            srcDoc={preview.html}
          />
          <details>
            <summary>Plain-text version</summary>
            <pre>{preview.text}</pre>
          </details>
        </section>
      )}
    </Modal>
  );
}

export function EmailTemplates({ notify = () => {} }) {
  const q = useData("/saas/owner/email-templates");
  const [selected, setSelected] = useState(null);
  const templates = (q.data || []).filter(
    (template) => !template.key.startsWith("onboarding_"),
  );
  return (
    <>
      <OnboardingEmails notify={notify} />
      <Panel
        title="Email templates"
        description="Manage the messages sent to schools and support teams. Each template includes branded HTML and a plain-text version."
      >
        <div className="email-template-library">
          {q.error ? (
            <p className="form-error" role="alert">
              {q.error}{" "}
              <Button small secondary onClick={q.reload}>
                Retry
              </Button>
            </p>
          ) : q.loading ? (
            <Loading />
          ) : !templates.length ? (
            <Empty title="No email templates available" />
          ) : (
            groups.map((group) => {
              const entries = templates.filter((template) =>
                group.keys.length
                  ? group.keys.includes(template.key)
                  : !groups.some((g) => g.keys.includes(template.key)),
              );
              return entries.length ? (
                <section
                  className="email-template-group"
                  key={group.name}
                  aria-label={group.name}
                >
                  <header>
                    <h3>{group.name}</h3>
                    <p>{group.description}</p>
                  </header>
                  {entries.map((template) => (
                    <div className="email-template-row" key={template.key}>
                      <div className="email-template-info">
                        <strong>{template.name}</strong>
                        <p>{template.subject}</p>
                      </div>
                      <span className="email-template-direction">
                        {template.direction}
                      </span>
                      <Button
                        small
                        secondary
                        onClick={() => setSelected(template)}
                      >
                        Edit {template.name}
                      </Button>
                    </div>
                  ))}
                </section>
              ) : null;
            })
          )}
          <p className="muted">
            Inbound alerts notify your team about support requests submitted
            through SMPIS.
          </p>
        </div>
      </Panel>
      {selected && (
        <TemplateEditor
          key={selected.key}
          template={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            q.reload();
            notify("Email template saved.");
          }}
        />
      )}
    </>
  );
}
