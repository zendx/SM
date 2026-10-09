import React, { useState } from "react";
import { useData } from "../hooks";
import { get, post, patch } from "../api";
import { Panel, Button, Form, Modal, Table } from "../components";

export function OnboardingEmails({ notify = () => {} }) {
  const q = useData("/saas/owner/onboarding-emails");
  const [selected, setSelected] = useState(null),
    [preview, setPreview] = useState(null),
    [error, setError] = useState("");
  const loadPreview = async (step) => {
    setError("");
    try {
      setPreview(
        await get(`/saas/owner/onboarding-emails/steps/${step.id}/preview`),
      );
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <Panel
        title="New-user email sequence"
        description="Welcome emails queue immediately after school registration. The default portal tour follows 30 minutes later. The worker sends due emails even when users are online. These are account guidance emails, separate from promotional newsletters."
        action={
          <Button
            small
            onClick={() =>
              setSelected({
                name: "",
                subject: "",
                body: "Hello {{name}},\n\nOpen your school portal: {{link}}",
                delay_minutes: 60,
                enabled: true,
              })
            }
          >
            Add scheduled email
          </Button>
        }
      >
        {(q.error || error) && <p className="form-error">{q.error || error}</p>}
        <Table
          rows={q.data?.steps || []}
          columns={[
            { label: "Email", key: "name" },
            {
              label: "Send after registration",
              render: (s) =>
                s.delay_minutes === 0
                  ? "Immediately"
                  : `${s.delay_minutes} minutes`,
            },
            {
              label: "Status",
              render: (s) => (s.enabled ? "Enabled" : "Paused"),
            },
            {
              label: "Actions",
              render: (s) => (
                <div className="toolbar">
                  <Button small secondary onClick={() => setSelected(s)}>
                    Edit {s.name}
                  </Button>
                  <Button small secondary onClick={() => loadPreview(s)}>
                    Preview {s.name}
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <p className="muted">
          Delays are measured from registration, from 0 to 43,200 minutes (30
          days). Enabled steps automatically queue for future registrations.
          Editing a delay reschedules waiting emails; delivery already in
          progress completes. Paused steps hold existing waiting emails and skip
          new registrations. Resuming a step sends any overdue waiting emails on
          the next worker run.
        </p>
      </Panel>
      <Panel
        title="Onboarding delivery queue"
        description="Recent onboarding emails, including their scheduled delivery times. The worker checks every minute and retries failures up to five times."
      >
        <p>
          {(q.data?.counts || [])
            .map((c) => `${c.count} ${c.delivery_status.toLowerCase()}`)
            .join(" · ") || "No onboarding emails queued yet."}
        </p>
        <Table
          rows={q.data?.queue || []}
          columns={[
            {
              label: "Recipient",
              render: (r) => (
                <>
                  <strong>{r.user_name}</strong>
                  <br />
                  <small>
                    {r.school_name} · {r.email}
                  </small>
                </>
              ),
            },
            { label: "Email", key: "step_name" },
            {
              label: "Scheduled (Lagos)",
              render: (r) =>
                new Date(r.scheduled_at).toLocaleString("en-NG", {
                  timeZone: "Africa/Lagos",
                }),
            },
            {
              label: "Status",
              render: (r) =>
                r.delivery_status === "PENDING" && !r.enabled
                  ? "Paused"
                  : r.delivery_status.toLowerCase(),
            },
            { label: "Attempts", key: "attempts" },
            {
              label: "Actions",
              render: (r) =>
                r.delivery_status === "FAILED" ? (
                  <Button
                    small
                    secondary
                    onClick={async () => {
                      setError("");
                      try {
                        const result = await post(
                          `/saas/owner/onboarding-emails/queue/${r.id}/retry`,
                          {},
                        );
                        notify(result.message);
                        q.reload();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Retry email
                  </Button>
                ) : (
                  "—"
                ),
            },
          ]}
        />
        <Button small secondary onClick={q.reload}>
          Refresh delivery queue
        </Button>
      </Panel>
      {selected && (
        <Modal
          title={
            selected.id
              ? `Edit ${selected.name}`
              : "Add scheduled onboarding email"
          }
          onClose={() => setSelected(null)}
        >
          <p>
            Your message uses the SMPIS HTML design and logo automatically.
            Placeholders:{" "}
            {
              "{{name}}, {{school_name}}, {{link}}, {{security_link}}, {{guide}}"
            }
            . Keep {"{{link}}"} in the message. The guide placeholder inserts
            the portal menu tour.
          </p>
          <Form
            initial={selected}
            fields={[
              { name: "name", label: "Email name", wide: true, maxLength: 120 },
              {
                name: "subject",
                label: "Email subject",
                wide: true,
                maxLength: 200,
              },
              {
                name: "body",
                label: "Email message",
                type: "textarea",
                wide: true,
              },
              {
                name: "delay_minutes",
                label: "Minutes after registration",
                type: "number",
                min: 0,
                max: 43200,
                step: 1,
                wide: true,
              },
              {
                name: "enabled",
                label: "Enable this email for new registrations",
                type: "checkbox",
                required: false,
                wide: true,
              },
            ]}
            submit="Save onboarding email"
            onSubmit={async (values) => {
              const result = selected.id
                ? await patch(
                    `/saas/owner/onboarding-emails/steps/${selected.id}`,
                    values,
                  )
                : await post("/saas/owner/onboarding-emails/steps", values);
              setSelected(null);
              q.reload();
              notify(result.message);
            }}
          />
        </Modal>
      )}
      {preview && (
        <Modal title={preview.subject} onClose={() => setPreview(null)}>
          <iframe
            title="Onboarding HTML email preview"
            sandbox=""
            srcDoc={preview.html}
            style={{ width: "100%", height: 560, border: 0 }}
          />
        </Modal>
      )}
    </>
  );
}
