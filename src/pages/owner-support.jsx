import {
  OwnerSchoolAccounts,
  RetainedAccountRecord,
} from "./owner-school-accounts";
import React, { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { useData } from "../hooks";
import { post, patch } from "../api";
import { Panel, Table, Form, Modal, Button, Badge } from "../components";

export function OwnerAccounts({ notify = () => {} }) {
  const [selected, setSelected] = useState(null),
    [reset, setReset] = useState(null),
    [record, setRecord] = useState(null),
    [revision, setRevision] = useState(0);
  return (
    <Panel
      title="Customer schools"
      description="Click a school name to view its administrators, teachers, parents and other users."
    >
      <OwnerSchoolAccounts
        revision={revision}
        onManage={(user, roles) => setSelected({ ...user, roles })}
        onRetained={setRecord}
      />
      {record && (
        <RetainedAccountRecord user={record} onClose={() => setRecord(null)} />
      )}
      {selected && (
        <Modal
          title={`Manage ${selected.name}`}
          onClose={() => setSelected(null)}
        >
          <p>
            Changes end this user’s current sessions. Record the reason for
            every support action.
          </p>
          <Form
            initial={selected}
            fields={[
              { name: "name", label: "Full name", wide: true },
              {
                name: "email",
                label: "Email address",
                type: "email",
                wide: true,
              },
              { name: "role", label: "Role", options: selected.roles },
              {
                name: "status",
                label: "Account status",
                options: ["ACTIVE", "SUSPENDED"],
              },
              {
                name: "reason",
                label: "Reason for account update",
                type: "textarea",
                wide: true,
              },
            ]}
            submit="Save account changes"
            onSubmit={async (v) => {
              await post(`/saas/owner/users/${selected.id}/action`, {
                ...v,
                action: "UPDATE",
              });
              setSelected(null);
              setRevision((value) => value + 1);
              notify("Customer account updated.");
            }}
          />
          <hr />
          <h3>Resolve an access problem</h3>
          <Form
            initial={{ action: "RESET_PASSWORD" }}
            fields={[
              {
                name: "action",
                label: "Recovery action",
                options: [
                  {
                    value: "RESET_PASSWORD",
                    label: "Create one-time password reset link",
                  },
                  {
                    value: "REVOKE_SESSIONS",
                    label: "End all signed-in sessions",
                  },
                  {
                    value: "RESET_MFA",
                    label: "Reset authenticator after identity verification",
                  },
                ],
                wide: true,
              },
              {
                name: "reason",
                label: "Reason for recovery action",
                type: "textarea",
                wide: true,
              },
            ]}
            submit="Apply recovery action"
            onSubmit={async (v) => {
              const result = await post(
                `/saas/owner/users/${selected.id}/action`,
                v,
              );
              setSelected(null);
              setRevision((value) => value + 1);
              if (result.reset_url) setReset(result);
              notify(result.message);
            }}
          />
        </Modal>
      )}
      {reset && (
        <Modal
          title="One-time account recovery link"
          onClose={() => setReset(null)}
        >
          <p>
            {reset.message} The link expires in {reset.expires_in_minutes}{" "}
            minutes.
          </p>
          <label className="field">
            <span>Password reset link</span>
            <input
              readOnly
              value={reset.reset_url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <Button onClick={() => setReset(null)}>Done</Button>
        </Modal>
      )}
    </Panel>
  );
}
function SupportReplies({ ticket }) {
  const replies = ticket.replies || [];
  if (!replies.length)
    return <span>{ticket.resolution || "Awaiting response"}</span>;
  return (
    <div>
      {replies.map((reply) => (
        <div key={reply.id} className="support-description">
          <strong>{reply.author}</strong>
          <small className="table-sub">
            {new Date(reply.created_at).toLocaleString()}
          </small>
          <p>{reply.body}</p>
        </div>
      ))}
    </div>
  );
}
export function OwnerIssues({ notify = () => {} }) {
  const q = useData("/saas/owner/issues"),
    [department, setDepartment] = useState("ALL"),
    [selected, setSelected] = useState(null);
  return (
    <Panel
      title="Customer support queue"
      description="Reply to customer support requests, follow progress and resolve issues."
    >
      {q.error && <p className="form-error">{q.error}</p>}
      <label className="field">
        <span>Support department</span>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="ALL">All assigned departments</option>
          <option value="SALES">Sales Department</option>
          <option value="TECHNICAL">Technical Department</option>
        </select>
      </label>
      <Table
        rows={(q.data || []).filter(
          (t) => department === "ALL" || t.department === department,
        )}
        columns={[
          { label: "Department", key: "department" },
          {
            label: "Issue",
            render: (t) => (
              <div>
                <strong>
                  #{t.id} · {t.subject}
                </strong>
                <small className="table-sub">
                  {new Date(t.created_at).toLocaleDateString()}
                </small>
              </div>
            ),
          },
          {
            label: "Customer",
            render: (t) => (
              <div>
                {t.school_name}
                <small className="table-sub">
                  {t.user_name} · {t.user_email}
                </small>
              </div>
            ),
          },
          { label: "Status", render: (t) => <Badge value={t.status} /> },
          {
            label: "Manage",
            render: (t) => (
              <Button small secondary onClick={() => setSelected(t)}>
                Reply / manage ticket
              </Button>
            ),
          },
        ]}
      />
      {selected && (
        <Modal
          title={`Support issue #${selected.id}`}
          onClose={() => setSelected(null)}
        >
          <h3>{selected.subject}</h3>
          <p className="support-description">{selected.description}</p>
          <SupportReplies ticket={selected} />
          <Form
            initial={{ status: selected.status, resolution: "" }}
            fields={[
              {
                name: "status",
                label: "Issue status",
                options: ["OPEN", "IN_PROGRESS", "RESOLVED"],
                wide: true,
              },
              {
                name: "resolution",
                label: "Reply to customer",
                type: "textarea",
                wide: true,
                required: false,
              },
            ]}
            submit="Send reply / update status"
            onSubmit={async (v) => {
              await patch(`/saas/owner/issues/${selected.id}`, v);
              setSelected(null);
              q.reload();
              notify(
                v.resolution?.trim()
                  ? "Reply sent to customer."
                  : "Support status updated.",
              );
            }}
          />
          <p className="muted">
            Replies appear in the customer's Support menu and inbox, and are
            emailed when they are inactive. Leave the reply blank to change only
            the status.
          </p>
        </Modal>
      )}
    </Panel>
  );
}
export function SchoolSupport() {
  const q = useData("/subscription/support"),
    [open, setOpen] = useState(false);
  return (
    <Panel
      title="Get help from SMPIS"
      description="Contact the Sales Department or Technical Department, even when school access is paused."
      action={
        <Button small secondary onClick={() => setOpen(true)}>
          <LifeBuoy size={16} /> Report an issue
        </Button>
      }
    >
      {q.error && <p className="form-error">{q.error}</p>}
      <Table
        rows={q.data}
        columns={[
          { label: "Department", key: "department" },
          { label: "Issue", key: "subject" },
          { label: "Status", render: (t) => <Badge value={t.status} /> },
          {
            label: "Owner response",
            render: (t) => (
              <div className="support-description">
                <SupportReplies ticket={t} />
              </div>
            ),
          },
        ]}
      />
      {open && (
        <Modal title="Report an issue to SMPIS" onClose={() => setOpen(false)}>
          <Form
            fields={[
              {
                name: "department",
                label: "Department",
                options: [
                  { value: "SALES", label: "Sales Department" },
                  { value: "TECHNICAL", label: "Technical Department" },
                ],
                default: "TECHNICAL",
                wide: true,
              },
              { name: "subject", label: "Issue subject", wide: true },
              {
                name: "description",
                label: "Describe the problem",
                type: "textarea",
                wide: true,
              },
            ]}
            submit="Submit support request"
            onSubmit={async (v) => {
              await post("/subscription/support", v);
              setOpen(false);
              q.reload();
            }}
          />
          <p className="muted">
            Include what happened and what you expected. Keep passwords and card
            details out of your request.
          </p>
        </Modal>
      )}
    </Panel>
  );
}
