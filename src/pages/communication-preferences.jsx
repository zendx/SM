import React, { useState } from "react";
import { useData } from "../hooks";
import { patch, post } from "../api";
import { Panel, Form, Button } from "../components";
import { PublicBrand } from "./saas-public";

export function ContactPreferences() {
  const q = useData("/subscription/contact-preferences");
  const [message, setMessage] = useState("");
  return (
    <Panel
      title="Communication preferences"
      description="Choose promotional messages separately from account, security and service notifications."
    >
      {q.error && <p className="form-error">{q.error}</p>}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {q.data && (
        <Form
          key={q.data.updated_at || "preferences"}
          initial={q.data}
          fields={[
            {
              name: "marketing_email_consent",
              label:
                "Receive promotional email newsletters, offers and product news",
              type: "checkbox",
              required: false,
              wide: true,
            },
            {
              name: "marketing_phone_consent",
              label: "Receive promotional messages using my phone number",
              type: "checkbox",
              required: false,
              wide: true,
            },
          ]}
          submit="Save communication preferences"
          onSubmit={async (values) => {
            const result = await patch(
              "/subscription/contact-preferences",
              values,
            );
            setMessage(result.message);
            q.reload();
          }}
        />
      )}
      <p className="muted">
        You can withdraw either choice at any time. Read our{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          privacy policy
        </a>
        .
      </p>
    </Panel>
  );
}

export function UnsubscribePage() {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const token = new URLSearchParams(location.search).get("unsubscribe");
  return (
    <main className="signup-shell">
      <PublicBrand />
      <section
        className="signup-form"
        style={{ maxWidth: 620, margin: "40px auto" }}
      >
        <h1>Promotional email preferences</h1>
        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : (
          <>
            <p>
              Unsubscribe from SMPIS promotional newsletters, offers and product
              news. Account verification, security, support and service emails
              will continue.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setMessage(
                    (await post("/communications/unsubscribe", { token }))
                      .message,
                  );
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : "Unsubscribe from promotional emails"}
            </Button>
          </>
        )}
        <p>
          <a href="/login">Sign in</a> to manage email and phone choices in your
          SMPIS inbox.
        </p>
      </section>
    </main>
  );
}
