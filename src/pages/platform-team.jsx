import React, { useState } from "react";
import { useData } from "../hooks";
import { post, patch } from "../api";
import { Panel, Table, Form, Modal, Button, Badge } from "../components";

const scopes = [
  { value: "SALES", label: "Sales support only" },
  { value: "TECHNICAL", label: "Technical support only" },
  { value: "SUBSCRIPTIONS", label: "Schools and subscriptions only" },
];
export function PlatformTeam({ notify = () => {} }) {
  const q = useData("/saas/owner/team"),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState(null);
  return (
    <Panel
      title="Owner console team"
      description="Delegate one area of work per account. Delegated accounts cannot view tenant dashboards, payment settings, or manage other staff."
      action={
        <Button onClick={() => setCreate(true)}>Create team account</Button>
      }
    >
      {q.error && <p className="form-error">{q.error}</p>}
      <Table
        rows={q.data}
        columns={[
          { label: "Name", key: "name" },
          { label: "Email", key: "email" },
          { label: "Assigned access", key: "scope" },
          { label: "Status", render: (u) => <Badge value={u.status} /> },
          {
            label: "Verification",
            render: (u) =>
              u.email_verified ? "Verified" : "Email verification pending",
          },
          {
            label: "Manage",
            render: (u) => (
              <Button small secondary onClick={() => setSelected(u)}>
                Edit access
              </Button>
            ),
          },
        ]}
      />
      {create && (
        <Modal
          title="Create delegated console account"
          onClose={() => setCreate(false)}
        >
          <Form
            fields={[
              { name: "name", label: "Full name", wide: true },
              {
                name: "email",
                label: "Email address",
                type: "email",
                wide: true,
              },
              {
                name: "password",
                label: "Initial password",
                type: "password",
                minLength: 12,
                wide: true,
                autoComplete: "new-password",
              },
              {
                name: "scope",
                label: "Assigned access",
                options: scopes,
                wide: true,
              },
            ]}
            submit="Create account and send verification"
            onSubmit={async (v) => {
              await post("/saas/owner/team", v);
              setCreate(false);
              q.reload();
              notify(
                "Team account created. Share the initial password securely; the recipient must verify their email before signing in at /owner.",
              );
            }}
          />
        </Modal>
      )}
      {selected && (
        <Modal
          title={`Edit ${selected.name}`}
          onClose={() => setSelected(null)}
        >
          <Form
            initial={selected}
            fields={[
              {
                name: "scope",
                label: "Assigned access",
                options: scopes,
                wide: true,
              },
              {
                name: "status",
                label: "Account status",
                options: ["ACTIVE", "SUSPENDED"],
                wide: true,
              },
              {
                name: "reason",
                label: "Reason for change",
                type: "textarea",
                wide: true,
              },
            ]}
            onSubmit={async (v) => {
              await patch(`/saas/owner/team/${selected.id}`, v);
              setSelected(null);
              q.reload();
              notify("Team access updated and existing sessions ended.");
            }}
            submit="Save access"
          />
        </Modal>
      )}
    </Panel>
  );
}

export function TenantAccountControls({ sub, reload }) {
  const [action, setAction] = useState(null);
  return (
    <Panel
      title="Manage your SMPIS account"
      description="Your school records are retained when you pause or request account deletion."
    >
      {sub.deletion_requested_at ? (
        <div className="notice">
          Account deletion requested. School operations are suspended.
          Administrator Support access ends on{" "}
          {new Date(sub.deletion_effective_at).toLocaleDateString()}. After this
          date, all school sign-in is blocked and your email addresses remain
          reserved. Contact SMPIS for reactivation.
        </div>
      ) : (
        <>
          <p>
            Pausing stops school operations and keeps your current expiry date.
            It does not preserve unused subscription time or restart your trial.
          </p>
          <div className="toolbar">
            {sub.suspension_reason === "TENANT_PAUSED" ? (
              <Button onClick={() => setAction("RESUME")}>
                Resume subscription
              </Button>
            ) : (
              ["TRIAL", "ACTIVE", "PENDING_PAYMENT"].includes(sub.status) && (
                <Button secondary onClick={() => setAction("PAUSE")}>
                  Pause subscription
                </Button>
              )
            )}
            {sub.status !== "TERMINATED" && (
              <Button secondary onClick={() => setAction("DELETE")}>
                Request account deletion
              </Button>
            )}
          </div>
        </>
      )}
      {action && (
        <Modal
          title={
            action === "DELETE"
              ? "Request account deletion"
              : action === "PAUSE"
                ? "Pause subscription"
                : "Resume subscription"
          }
          onClose={() => setAction(null)}
        >
          <p>
            {action === "DELETE"
              ? "School operations stop immediately. Administrators can use Support for three calendar months, then every school account is blocked from signing in. Records remain in SMPIS and registered email addresses cannot be reused until the owner reactivates your school."
              : "Your original subscription expiry will stay unchanged. Resuming an expired subscription requires renewal before school operations are available."}
          </p>
          <Form
            fields={[
              { name: "reason", label: "Reason", type: "textarea", wide: true },
              {
                name: "password",
                label: "Confirm your password",
                type: "password",
                wide: true,
              },
            ]}
            submit={
              action === "DELETE"
                ? "Confirm deletion request"
                : "Confirm account change"
            }
            onSubmit={async (v) => {
              await post("/subscription/account", { ...v, action });
              setAction(null);
              reload();
            }}
          />
        </Modal>
      )}
    </Panel>
  );
}

export function ManagedSchools({
  fullOwner = false,
  onlyDeletion = false,
  onChange = () => {},
  notify = () => {},
}) {
  const q = useData("/saas/owner/tenants"),
    [selected, setSelected] = useState(null);
  const tenants = (q.data || []).filter(
    (school) => !onlyDeletion || school.deletion_requested_at,
  );
  if (onlyDeletion && q.data && !tenants.length) return null;
  return (
    <Panel
      title={
        onlyDeletion ? "Account closure requests" : "Schools and subscriptions"
      }
      description="Manage school subscription access. Account deletion retains records and email addresses."
      action={
        fullOwner &&
        !onlyDeletion && (
          <a className="btn" href="/signup">
            Create school portal
          </a>
        )
      }
    >
      {q.error && <p className="form-error">{q.error}</p>}
      <Table
        rows={tenants}
        columns={[
          { label: "School", key: "name" },
          { label: "Plan", key: "plan" },
          {
            label: "Status",
            render: (s) => (
              <>
                <Badge value={s.status} />
                <small className="table-sub">
                  {s.suspension_reason.replaceAll("_", " ")}
                </small>
              </>
            ),
          },
          {
            label: "Expiry",
            render: (s) => new Date(s.period_end).toLocaleDateString(),
          },
          {
            label: "Deletion deadline",
            render: (s) =>
              s.deletion_effective_at
                ? new Date(s.deletion_effective_at).toLocaleDateString()
                : "—",
          },
          ...(fullOwner
            ? [
                {
                  label: "Portal",
                  render: (s) => (
                    <a href={`/${s.portal_slug}/`}>Open school portal</a>
                  ),
                },
              ]
            : []),
          {
            label: "Manage",
            render: (s) =>
              s.deletion_requested_at ? (
                fullOwner ? (
                  <Button
                    small
                    secondary
                    onClick={() => setSelected({ ...s, action: "REACTIVATE" })}
                  >
                    Reactivate account
                  </Button>
                ) : (
                  "Owner reactivation required"
                )
              ) : s.status === "TERMINATED" ? (
                "Terminated"
              ) : (
                <div className="toolbar">
                  <Button
                    small
                    secondary
                    onClick={() =>
                      setSelected({
                        ...s,
                        action:
                          s.status === "SUSPENDED" ? "RESTORE" : "SUSPEND",
                      })
                    }
                  >
                    {s.status === "SUSPENDED" ? "Restore" : "Suspend"}
                  </Button>
                </div>
              ),
          },
        ]}
      />
      {selected && (
        <Modal
          title={`${selected.action === "REACTIVATE" ? "Reactivate" : selected.action === "RESTORE" ? "Restore" : "Suspend"} ${selected.name}`}
          onClose={() => setSelected(null)}
        >
          {selected.action === "REACTIVATE" && (
            <p>
              Restore sign-in without resetting the trial or extending
              subscription expiry. Expired schools will need to renew.
            </p>
          )}
          <Form
            fields={[
              { name: "reason", label: "Reason", type: "textarea", wide: true },
              ...(selected.action === "RESTORE" && selected.plan === "PRO"
                ? [
                    {
                      name: "access_until",
                      label: "Access expiry",
                      type: "date",
                      default: new Date(selected.period_end)
                        .toISOString()
                        .slice(0, 10),
                      wide: true,
                    },
                  ]
                : []),
            ]}
            submit="Confirm change"
            onSubmit={async (v) => {
              if (selected.action === "REACTIVATE")
                await post(
                  `/saas/owner/tenants/${selected.school_id}/reactivate`,
                  v,
                );
              else
                await patch(`/saas/owner/tenants/${selected.school_id}`, {
                  ...v,
                  action: selected.action,
                  ...(v.access_until
                    ? { access_until: v.access_until + "T23:59:59.000Z" }
                    : {}),
                });
              setSelected(null);
              q.reload();
              onChange();
              notify("School access updated.");
            }}
          />
        </Modal>
      )}
    </Panel>
  );
}
