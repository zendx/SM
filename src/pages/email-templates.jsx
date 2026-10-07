import React, { useState } from "react";
import { useData } from "../hooks";
import { patch } from "../api";
import { Panel, Form, Button, Modal } from "../components";

export function EmailTemplates({ notify = () => {} }) {
  const q = useData("/saas/owner/email-templates"),
    [selected, setSelected] = useState(null);
  return (
    <Panel
      title="Email templates"
      description="Edit platform emails to tenants and support-ticket alerts to the owner and assigned department. Templates are plain text."
    >
      {q.error && <p className="form-error">{q.error}</p>}
      {(q.data || []).map((template) => (
        <div className="toolbar" key={template.key}>
          <strong>{template.name}</strong>
          <span>{template.direction}</span>
          <Button small secondary onClick={() => setSelected(template)}>
            Edit {template.name}
          </Button>
        </div>
      ))}
      <p className="muted">
        Inbound alerts describe support requests submitted through the portal.
        This setting does not connect an email inbox.
      </p>
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <p>
            Available placeholders:{" "}
            {selected.variables.map((v) => `{{${v}}}`).join(", ")}. Keep the
            link placeholder where available; notification and reminder
            templates must also include the message body.
          </p>
          <Form
            initial={{ subject: selected.subject, body: selected.body }}
            fields={[
              {
                name: "subject",
                label: "Email subject",
                wide: true,
                maxLength: 200,
              },
              {
                name: "body",
                label: "Email message template",
                type: "textarea",
                wide: true,
              },
            ]}
            submit="Save email template"
            onSubmit={async (values) => {
              await patch(
                `/saas/owner/email-templates/${selected.key}`,
                values,
              );
              setSelected(null);
              q.reload();
              notify("Email template saved.");
            }}
          />
        </Modal>
      )}
    </Panel>
  );
}
