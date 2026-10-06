import React, { useState } from "react";
import { useData } from "../hooks";
import { patch } from "../api";
import { Panel, Form, Loading, Button } from "../components";
const definitions = {
  smtp: {
    title: "SMTP email",
    description: "Used for password reset emails and notification delivery.",
    fields: [
      { name: "host", label: "SMTP hostname" },
      {
        name: "port",
        label: "Port",
        type: "number",
        default: 587,
        min: 1,
        max: 65535,
      },
      {
        name: "secure",
        label: "Use TLS immediately (usually port 465)",
        type: "checkbox",
      },
      { name: "username", label: "Username" },
      { name: "password", label: "Password", type: "password" },
      { name: "from", label: "Sender email", type: "email" },
    ],
  },
  paystack: {
    title: "Paystack",
    description:
      "Used by the existing online payment checkout. Live payments also require an HTTPS application URL.",
    fields: [
      { name: "public_key", label: "Public key" },
      { name: "secret_key", label: "Secret key", type: "password" },
      { name: "live_enabled", label: "Allow live payments", type: "checkbox" },
    ],
  },
  flutterwave: {
    title: "Flutterwave",
    description:
      "Save your provider credentials. Flutterwave checkout is not yet available in this application.",
    fields: [
      { name: "public_key", label: "Public key" },
      { name: "secret_key", label: "Secret key", type: "password" },
      { name: "webhook_secret", label: "Webhook secret", type: "password" },
    ],
  },
  twilio: {
    title: "Twilio",
    description:
      "Save your SMS credentials. SMS delivery is not yet available in this application.",
    fields: [
      { name: "account_sid", label: "Account SID" },
      { name: "auth_token", label: "Auth token", type: "password" },
      { name: "from", label: "Sender number" },
      { name: "messaging_service_sid", label: "Messaging service SID" },
    ],
  },
};
function ProviderForm({ provider, config, notify, onSaved }) {
  const d = definitions[provider];
  const [revision, setRevision] = useState(0);
  return (
    <Panel title={d.title} description={d.description}>
      <Form
        key={revision}
        initial={config}
        fields={[
          {
            name: "enabled",
            label: "Enable this integration",
            type: "checkbox",
          },
          ...d.fields.map((f) => ({
            ...f,
            required: false,
            ...(f.type === "password"
              ? {
                  autoComplete: "new-password",
                  hint: config[`${f.name}_configured`]
                    ? "Saved securely. Leave blank to keep the current value."
                    : "No credential saved.",
                }
              : {}),
          })),
        ]}
        onSubmit={async (values) => {
          await patch(`/admin/integrations/${provider}`, values);
          setRevision((v) => v + 1);
          onSaved();
          notify(`${d.title} settings saved`);
        }}
      />
      <div className="provider-actions">
        <Button
          secondary
          onClick={async () => {
            try {
              const clean = Object.fromEntries(
                d.fields.map((f) => [
                  f.name,
                  f.type === "checkbox"
                    ? false
                    : f.type === "number"
                      ? 587
                      : "",
                ]),
              );
              await patch(`/admin/integrations/${provider}`, {
                ...clean,
                enabled: false,
                clear_secrets: d.fields
                  .filter((f) => f.type === "password")
                  .map((f) => f.name),
              });
              setRevision((v) => v + 1);
              onSaved();
              notify(`${d.title} credentials removed`);
            } catch (e) {
              notify(e.message);
            }
          }}
        >
          Remove credentials and disable
        </Button>
      </div>
    </Panel>
  );
}
export function IntegrationSettings({ notify }) {
  const q = useData("/admin/integrations", null);
  if (q.loading) return <Loading />;
  if (q.error)
    return (
      <div className="notice" role="alert">
        {q.error}
        <Button secondary onClick={q.reload}>
          Retry
        </Button>
      </div>
    );
  return (
    <div className="admin-settings">
      <div className="notice">
        These settings apply to this school. Saved secrets are encrypted and
        never displayed again.
      </div>
      {Object.keys(definitions).map((provider) => (
        <ProviderForm
          key={provider}
          provider={provider}
          config={q.data[provider]}
          notify={notify}
          onSaved={q.reload}
        />
      ))}
    </div>
  );
}
