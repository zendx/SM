import React, { useEffect, useState } from "react";
import { useData } from "../hooks";
import { post } from "../api";
import { Panel, Table, Button } from "../components";
export function EmailDeliveryStatus() {
  const q = useData("/saas/owner/email-delivery", null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setInterval(q.reload, 30000);
    return () => clearInterval(timer);
  }, []);
  const worker = q.data?.worker;
  return (
    <Panel
      title="Email delivery and worker status"
      description="The Railway worker sends queued messages. Status refreshes every 30 seconds."
      action={
        <Button secondary onClick={q.reload}>
          Refresh delivery status
        </Button>
      }
    >
      {(q.error || error) && <p className="form-error">{q.error || error}</p>}
      {message && <p className="notice">{message}</p>}
      {q.data && (
        <>
          <p className={worker?.recent ? "notice" : "form-error"}>
            {worker?.recent
              ? "Worker heartbeat is current."
              : worker
                ? "No recent worker heartbeat. Check the Railway worker service and deployment logs."
                : "No worker heartbeat recorded. Deploy and start the updated Railway worker."}
          </p>
          <p>
            Web app email ({q.data.web_email_provider || "smtp"}):{" "}
            {q.data.web_smtp_configured ? "configured" : "missing"} · Worker
            email ({worker?.email_provider || "not reported"}):{" "}
            {worker
              ? worker.smtp_configured
                ? "configured"
                : "missing"
              : "not reported"}
          </p>
          {worker && (
            <p>
              Last heartbeat: {new Date(worker.last_seen_at).toLocaleString()} ·
              Last completed run:{" "}
              {worker.last_completed_at
                ? new Date(worker.last_completed_at).toLocaleString()
                : "not yet completed"}
            </p>
          )}
          {worker?.last_error && (
            <p className="form-error">
              Last worker errors: {worker.last_error}
            </p>
          )}
          <Table
            rows={q.data.counts.map((r) => ({
              ...r,
              rowKey: `${r.queue}:${r.status}`,
            }))}
            keyField="rowKey"
            columns={[
              { label: "Queue", key: "queue" },
              { label: "Status", key: "status" },
              { label: "Messages", key: "count" },
              {
                label: "Oldest",
                render: (r) => new Date(r.oldest).toLocaleString(),
              },
            ]}
            empty={{
              title: "No queued emails",
              description: "Email activity will appear here.",
            }}
          />
          <Table
            rows={q.data.failures.map((r) => ({
              ...r,
              rowKey: `${r.queue}:${r.id}`,
            }))}
            keyField="rowKey"
            columns={[
              { label: "Queue", key: "queue" },
              { label: "Recipient", key: "email" },
              { label: "Attempts", key: "attempts" },
              { label: "Last error", key: "last_error" },
            ]}
            empty={{
              title: "No recorded delivery failures",
              description:
                "SMTP acceptance confirms handoff; check the recipient spam folder if a sent message is missing.",
            }}
          />
          <Button
            secondary
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setMessage(
                  (await post("/saas/owner/email-delivery/retry", {})).message,
                );
                q.reload();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry failed emails
          </Button>
        </>
      )}
    </Panel>
  );
}
