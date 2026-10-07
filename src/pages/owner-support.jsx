import React, { useEffect, useState } from "react";
import { Search, LifeBuoy, Users, ArrowUpRight } from "lucide-react";
import { useData } from "../hooks";
import { post, patch } from "../api";
import {
  Panel,
  Table,
  Form,
  Modal,
  Button,
  Badge,
  Loading,
} from "../components";

export function OwnerAccounts({ notify = () => {} }) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(null),
    [reset, setReset] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const q = useData(
    `/saas/owner/users?search=${encodeURIComponent(query)}&page=${page}`,
    null,
  );
  return (
    <Panel
      title="Customer accounts"
      description="Find accounts across your customer schools and resolve access issues."
    >
      <div className="owner-account-toolbar">
        <Search size={18} />
        <input
          aria-label="Search customer accounts"
          placeholder="Search name, email or school…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{q.data?.total ?? "…"} accounts</span>
      </div>
      {q.error && <p className="form-error">{q.error}</p>}
      {q.loading && !q.data ? (
        <Loading />
      ) : (
        q.data && (
          <>
            <Table
              rows={q.data.users}
              columns={[
                {
                  label: "User",
                  render: (u) => (
                    <div>
                      <strong>{u.name}</strong>
                      <small className="table-sub">{u.email}</small>
                    </div>
                  ),
                },
                {
                  label: "School",
                  render: (u) => (
                    <a href={`/${u.portal_slug}/`}>
                      {u.school_name} <ArrowUpRight size={12} />
                    </a>
                  ),
                },
                { label: "Role", key: "role" },
                { label: "Status", render: (u) => <Badge value={u.status} /> },
                {
                  label: "Security",
                  render: (u) =>
                    u.mfa_enabled ? "MFA enabled" : "MFA not enabled",
                },
                { label: "Sessions", key: "active_sessions" },
                {
                  label: "Support",
                  render: (u) => (
                    <Button small secondary onClick={() => setSelected(u)}>
                      Manage account
                    </Button>
                  ),
                },
              ]}
            />
            <div className="owner-account-toolbar">
              <Button
                small
                secondary
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {page} of {Math.max(1, Math.ceil(q.data.total / 50))}
              </span>
              <Button
                small
                secondary
                disabled={page * 50 >= q.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )
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
              { name: "role", label: "Role", options: q.data.roles },
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
              q.reload();
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
              q.reload();
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
export function OwnerIssues({ notify = () => {} }) {
  const q = useData("/saas/owner/issues"),
    [department, setDepartment] = useState("ALL"),
    [selected, setSelected] = useState(null);
  return (
    <Panel
      title="Customer support queue"
      description="Track reported problems, investigate accounts and record the resolution."
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
                Review issue
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
          <Form
            initial={selected}
            fields={[
              {
                name: "status",
                label: "Issue status",
                options: ["OPEN", "IN_PROGRESS", "RESOLVED"],
                wide: true,
              },
              {
                name: "resolution",
                label: "Response / resolution",
                type: "textarea",
                wide: true,
                required: false,
              },
            ]}
            submit="Update support issue"
            onSubmit={async (v) => {
              await patch(`/saas/owner/issues/${selected.id}`, v);
              setSelected(null);
              q.reload();
              notify("Support issue updated.");
            }}
          />
          <p className="muted">
            Your response appears in the customer’s Support menu.
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
              <span className="support-description">
                {t.resolution || "Awaiting response"}
              </span>
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
