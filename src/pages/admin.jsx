import { SiteSettings } from "./site-settings";
import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { IntegrationSettings } from "./integrations";
import {
  Plus,
  Download,
  FileBarChart,
  Users,
  CalendarCheck,
  Wallet,
  ShieldCheck,
  Settings,
} from "lucide-react";
import { get, post, patch } from "../api";
import { useData } from "../hooks";
import { AcademicExports } from "./academics";
import {
  PageHead,
  Button,
  Panel,
  Table,
  Person,
  Badge,
  Modal,
  Form,
  human,
} from "../components";
export function Reports({ can, config, notify, term }) {
  const classes = useData(
      can("reports.students") || can("reports.attendance") ? "/classes" : null,
    ),
    [classId, setClassId] = useState("");
  const [format, setFormat] = useState("csv"),
    [from, setFrom] = useState(`${config.today.slice(0, 4)}-01-01`),
    [to, setTo] = useState(config.today);
  const reports = [
    [
      "students",
      "Student register",
      "An overview of student enrollment, class allocations and status.",
      Users,
    ],
    [
      "attendance",
      "Student attendance",
      "Daily attendance records with student, class and status.",
      CalendarCheck,
    ],
    [
      "finance",
      "Fees & balances",
      "Billed, collected and outstanding amounts by invoice due date.",
      Wallet,
    ],
    [
      "staff",
      "Staff attendance",
      "Check-in, check-out, attendance status and hours worked.",
      FileBarChart,
    ],
    [
      "attendance-summary",
      "Attendance summary",
      "Recorded-day attendance totals and percentages by student.",
      CalendarCheck,
    ],
    [
      "chronic-absence",
      "Chronic absence",
      "Students below the school threshold, with at least three recorded days.",
      CalendarCheck,
    ],
    [
      "discipline",
      "Discipline cases",
      "Incident categories, stages and responsible staff.",
      ShieldCheck,
    ],
    [
      "complaints",
      "Parent complaints",
      "Complaint stages and resolution dates.",
      Users,
    ],
    [
      "maintenance",
      "Maintenance history",
      "Repair stages and recorded costs in minor currency units.",
      Settings,
    ],
    [
      "staff-performance",
      "Staff performance",
      "Recorded review scores by staff member and academic year.",
      Users,
    ],
  ].filter(([key]) =>
    can(
      {
        "attendance-summary": "reports.attendance",
        "chronic-absence": "reports.attendance",
        discipline: "discipline.manage",
        complaints: "complaints.manage",
        maintenance: "facilities.manage",
        "staff-performance": "hr.manage",
      }[key] || `reports.${key}`,
    ),
  );
  return (
    <>
      <PageHead
        title="Reports library"
        description="Turn school records into useful, shareable information."
      />
      <Panel>
        <div className="table-toolbar">
          {(can("reports.students") || can("reports.attendance")) && (
            <label className="inline-field">
              Register / attendance class
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">All allowed classes</option>
                {classes.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="inline-field">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="inline-field">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="inline-field">
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
        </div>
      </Panel>
      <div className="report-grid">
        {reports.map(([key, title, desc, Icon]) => (
          <Panel key={key}>
            <div className="report-card">
              <div className="report-icon">
                <Icon size={26} />
              </div>
              <h2>{title}</h2>
              <p>{desc}</p>
              <Button
                secondary
                onClick={async () => {
                  try {
                    const response = await fetch(
                      `/api/v1/reports/${key}?format=${format}&from=${from}&to=${to}${classId && ["students", "attendance", "attendance-summary", "chronic-absence"].includes(key) ? `&class_id=${classId}` : ""}`,
                    );
                    if (!response.ok) {
                      const data = await response.json();
                      throw new Error(
                        data.errors?.[0]?.message || "Report export failed.",
                      );
                    }
                    const url = URL.createObjectURL(await response.blob()),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = `smpis-${key}.${format}`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    notify("Report exported.");
                  } catch (e) {
                    notify(e.message);
                  }
                }}
              >
                <Download size={16} />
                Export report
              </Button>
            </div>
          </Panel>
        ))}
      </div>
      {(can("analytics.read") || can("analytics.summary")) && (
        <AcademicExports term={term} notify={notify} />
      )}
      {(can("curriculum.read") || can("curriculum.summary")) && (
        <AcademicExports curriculum term={term} notify={notify} />
      )}
      <p className="muted">
        Student register includes all current records. Attendance reports use
        the selected dates; finance reports use invoice due dates.
      </p>
    </>
  );
}
export function Administration({
  user,
  can,
  config,
  notify,
  reloadConfig,
  reloadSession,
}) {
  const isAdmin = can("admin.write") && !user.mfa_setup_required,
    users = useData(isAdmin ? "/users" : null),
    classes = useData(isAdmin ? "/classes" : null),
    audit = useData(isAdmin ? "/audit" : null);
  const [tab, setTab] = useState(
      !isAdmin || new URLSearchParams(location.search).get("security") === "mfa"
        ? "security"
        : "school",
    ),
    [modal, setModal] = useState(null),
    [mfa, setMfa] = useState(null),
    [enabled, setEnabled] = useState(user.mfa_enabled),
    [recovery, setRecovery] = useState(null);
  async function save(path, v, method = post) {
    const result = await method(path, v);
    setModal(null);
    users.reload();
    classes.reload();
    audit.reload();
    await reloadConfig();
    notify(result?.message || "Settings saved.");
  }
  const yearOptions = config.years.map((y) => ({ value: y.id, label: y.name }));
  return (
    <>
      <PageHead
        title={
          user.mfa_setup_required
            ? "Finish administrator security setup"
            : "Administration"
        }
        description={
          user.mfa_setup_required
            ? "Workspace pages unlock after you enable two-step verification."
            : "The foundations of a well-run school workspace."
        }
      />
      {user.mfa_setup_required && (
        <div className="notice" role="status">
          <strong>Complete this step to unlock the rest of SMPIS.</strong> Add
          this account to an authenticator app, enter its six-digit code below,
          and enable verification. Your other workspace pages will then appear.
        </div>
      )}
      <div className="tabs">
        {(isAdmin
          ? [
              "school",
              "classes",
              "calendar",
              "users",
              "permissions",
              "audit trail",
              "security",
              "integrations",
              "site settings",
            ]
          : ["security"]
        ).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={tab === t ? "active" : ""}
          >
            {human(t)}
          </button>
        ))}
      </div>
      {tab === "site settings" && user.role === "SUPER_ADMIN" && (
        <SiteSettings notify={notify} />
      )}
      {tab === "integrations" && user.role === "SUPER_ADMIN" && (
        <IntegrationSettings notify={notify} />
      )}
      {tab === "school" && (
        <Panel
          title="School settings"
          description="School-wide preferences and operational thresholds"
        >
          <div className="settings-form">
            <div className="notice">
              Public application form:{" "}
              <a
                href={`/?apply=${encodeURIComponent(config.school.short_code)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open admissions portal
              </a>
            </div>
            <Form
              initial={config.school}
              fields={[
                { name: "name", label: "School name", wide: true },
                { name: "currency_code", label: "Currency code", maxLength: 3 },
                { name: "timezone", label: "Timezone" },
                {
                  name: "attendance_threshold",
                  label: "Low attendance threshold (%)",
                  type: "number",
                  min: 1,
                  max: 100,
                },
                {
                  name: "staff_start",
                  label: "Staff start time",
                  type: "time",
                },
                {
                  name: "attendance_cutoff",
                  label: "Attendance cutoff",
                  type: "time",
                },
              ]}
              onSubmit={(v) => save("/config", v, patch)}
            />
            <div className="notice">
              Email:{" "}
              {config.smtp_configured
                ? "SMTP configured"
                : "Provider not configured. Messages stay in the notification outbox."}
            </div>
          </div>
        </Panel>
      )}
      {tab === "classes" && (
        <Panel
          title="Classes"
          action={
            <Button small onClick={() => setModal({ type: "class" })}>
              <Plus size={15} />
              New class
            </Button>
          }
        >
          <Table
            rows={classes.data}
            columns={[
              { label: "Class", key: "name" },
              { label: "Capacity", key: "capacity" },
              { label: "Enrolled", key: "enrolled" },
              {
                label: "Edit",
                render: (r) => (
                  <button
                    className="text-button"
                    onClick={() => setModal({ type: "class", row: r })}
                  >
                    Edit class
                  </button>
                ),
              },
              {
                label: "Class teacher",
                render: (r) => r.teacher_name || "Unassigned",
              },
              {
                label: "Year",
                render: (r) =>
                  config.years.find((y) => y.id === r.academic_year_id)?.name,
              },
            ]}
          />
        </Panel>
      )}
      {tab === "calendar" && (
        <>
          <Panel
            title="Academic years"
            action={
              <Button small onClick={() => setModal({ type: "year" })}>
                <Plus size={15} />
                New academic year
              </Button>
            }
          >
            <Table
              rows={config.years}
              columns={[
                { label: "Year", key: "name" },
                { label: "Starts", key: "start_date" },
                { label: "Ends", key: "end_date" },
              ]}
            />
          </Panel>
          <Panel
            title="Terms"
            action={
              <Button small onClick={() => setModal({ type: "term" })}>
                <Plus size={15} />
                New term
              </Button>
            }
          >
            <Table
              rows={config.terms}
              columns={[
                { label: "Term", key: "name" },
                {
                  label: "Year",
                  render: (r) =>
                    config.years.find((y) => y.id === r.academic_year_id)?.name,
                },
                { label: "Starts", key: "start_date" },
                { label: "Ends", key: "end_date" },
                {
                  label: "Current",
                  render: (r) =>
                    r.is_current ? (
                      <Badge value="ACTIVE" />
                    ) : (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            await save(`/terms/${r.id}/current`, {}, patch);
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        Make current
                      </button>
                    ),
                },
                {
                  label: "Edit",
                  render: (r) => (
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "edit-term", row: r })}
                    >
                      Edit dates
                    </button>
                  ),
                },
              ]}
            />
          </Panel>
        </>
      )}
      {tab === "users" && (
        <Panel
          title="User accounts"
          action={
            <Button small onClick={() => setModal({ type: "user" })}>
              <Plus size={15} />
              Create account
            </Button>
          }
        >
          {users.error && <p className="form-error">{users.error}</p>}
          <Table
            rows={users.data}
            columns={[
              { label: "ID", key: "id" },
              {
                label: "User",
                render: (r) => (
                  <div>
                    <strong>{r.name}</strong>
                    <small className="block muted">{r.email}</small>
                  </div>
                ),
              },
              { label: "Role", render: (r) => human(r.role) },
              { label: "Status", render: (r) => <Badge value={r.status} /> },
              {
                label: "MFA",
                render: (r) => (r.mfa_enabled ? "Enabled" : "Not enabled"),
              },
              {
                label: "Manage",
                render: (r) =>
                  r.id !== user.id && (
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "edit-user", row: r })}
                    >
                      Edit access
                    </button>
                  ),
              },
            ]}
          />
        </Panel>
      )}
      {tab === "permissions" && (
        <Panel
          title="Role permissions"
          description="Permissions are enforced by the API. Teachers are restricted to their assigned classes; parents to linked children."
        >
          <Table
            rows={Object.entries(config.role_permissions || {}).map(
              ([role, permissions]) => ({ id: role, role, permissions }),
            )}
            columns={[
              { label: "Role", render: (r) => human(r.role) },
              {
                label: "Permissions",
                render: (r) => (
                  <div className="permission-chips">
                    {r.permissions.map((p) => (
                      <code key={p}>{p === "*" ? "All permissions" : p}</code>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {tab === "audit trail" && (
        <Panel
          title="Audit trail"
          description="Latest 200 recorded actions. Previous and new values are available per event."
        >
          <Table
            rows={audit.data}
            columns={[
              {
                label: "When",
                render: (r) => new Date(r.occurred_at).toLocaleString(),
              },
              { label: "User", key: "user_name" },
              { label: "Action", render: (r) => <Badge value={r.action} /> },
              {
                label: "Record",
                render: (r) => `${human(r.entity_type)} #${r.entity_id}`,
              },
              {
                label: "Changes",
                render: (r) => (
                  <button
                    className="text-button"
                    onClick={() => setModal({ type: "audit", row: r })}
                  >
                    View changes
                  </button>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {tab === "security" && (
        <Panel
          title="Two-step verification"
          description="Protect your account with a time-based authenticator code."
        >
          <div className="security-panel">
            <ShieldCheck size={42} />
            {enabled ? (
              <>
                <h3>Two-step verification is enabled</h3>
                <p>Your authenticator code is required at sign-in.</p>
                <Form
                  fields={[
                    {
                      name: "password",
                      label: "Current password",
                      type: "password",
                      wide: true,
                    },
                  ]}
                  onSubmit={async (v) =>
                    setRecovery(
                      (await post("/auth/mfa/recovery-codes", v)).codes,
                    )
                  }
                  submit="Generate recovery codes"
                />
                {recovery && (
                  <div className="notice">
                    <p>
                      Save these codes securely. Each works once. Generating a
                      new set invalidates all previous codes.
                    </p>
                    {recovery.map((code) => (
                      <div key={code}>
                        <code>{code}</code>
                      </div>
                    ))}
                    <Button secondary onClick={() => setRecovery(null)}>
                      I have saved my codes
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h3>Add another layer of protection</h3>
                <p>
                  Add SMPIS to your authenticator app using a setup key, then
                  enter its six-digit code.
                </p>
                {!mfa ? (
                  <Button
                    onClick={async () => {
                      try {
                        setMfa(await post("/auth/mfa/setup", {}));
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  >
                    Set up authenticator
                  </Button>
                ) : (
                  <>
                    <p>Scan this QR code in your authenticator app.</p>
                    <div className="mfa-qr-code">
                      <QRCodeSVG
                        value={mfa.uri}
                        size={220}
                        level="M"
                        includeMargin
                        title="Authenticator setup QR code"
                        aria-label="Authenticator setup QR code"
                      />
                    </div>
                    <p>Or enter this authenticator setup key manually:</p>
                    <code className="secret-key">{mfa.secret}</code>
                    <p className="muted">
                      Account: {user.email} · Time-based · 6 digits · 30 seconds
                      · SHA1
                    </p>
                    <Form
                      fields={[
                        {
                          name: "code",
                          label: "Verification code",
                          wide: true,
                          maxLength: 6,
                        },
                      ]}
                      onSubmit={async (v) => {
                        await post("/auth/mfa/enable", v);
                        setEnabled(true);
                        setMfa(null);
                        await reloadSession();
                        notify("Two-step verification enabled.");
                      }}
                      submit="Enable verification"
                    />
                  </>
                )}
              </>
            )}
          </div>
        </Panel>
      )}
      {modal && (
        <Modal
          title={
            {
              class: "Create class",
              year: "Create academic year",
              term: "Create term",
              "edit-term": "Edit term dates",
              user: "Create user account",
              "edit-user": "Edit account access",
              audit: "Audit event details",
            }[modal.type]
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "class" && (
            <Form
              initial={modal.row || {}}
              fields={[
                { name: "name", label: "Class name", placeholder: "Grade 5A" },
                {
                  name: "capacity",
                  label: "Capacity",
                  type: "number",
                  min: 1,
                  max: 500,
                  default: 30,
                },
                {
                  name: "academic_year_id",
                  label: "Academic year",
                  options: yearOptions,
                },
                {
                  name: "teacher_user_id",
                  label: "Class teacher",
                  options: users.data
                    .filter((u) => u.role === "TEACHER")
                    .map((u) => ({ value: u.id, label: u.name })),
                  required: false,
                },
              ]}
              onSubmit={(v) =>
                save(
                  modal.row ? `/classes/${modal.row.id}` : "/classes",
                  {
                    ...v,
                    teacher_user_id: v.teacher_user_id
                      ? Number(v.teacher_user_id)
                      : null,
                  },
                  modal.row ? patch : post,
                )
              }
            />
          )}{" "}
          {modal.type === "year" && (
            <Form
              fields={[
                { name: "name", label: "Year name", wide: true },
                { name: "start_date", label: "Start date", type: "date" },
                { name: "end_date", label: "End date", type: "date" },
              ]}
              onSubmit={(v) => save("/academic-years", v)}
            />
          )}{" "}
          {modal.type === "term" && (
            <Form
              fields={[
                { name: "name", label: "Term name" },
                {
                  name: "academic_year_id",
                  label: "Academic year",
                  options: yearOptions,
                },
                { name: "start_date", label: "Start date", type: "date" },
                { name: "end_date", label: "End date", type: "date" },
                {
                  name: "is_current",
                  label: "Make this the current term",
                  type: "checkbox",
                },
              ]}
              onSubmit={(v) => save("/terms", v)}
            />
          )}{" "}
          {modal.type === "edit-term" && (
            <Form
              initial={modal.row}
              fields={[
                { name: "name", label: "Term name", wide: true },
                { name: "start_date", label: "Start date", type: "date" },
                { name: "end_date", label: "End date", type: "date" },
              ]}
              onSubmit={(v) => save(`/terms/${modal.row.id}`, v, patch)}
            />
          )}
          {modal.type === "user" && (
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
                },
                {
                  name: "role",
                  label: "Role",
                  options: config.roles,
                  wide: true,
                },
              ]}
              onSubmit={(v) => save("/users", v)}
            />
          )}{" "}
          {modal.type === "edit-user" && (
            <Form
              initial={modal.row}
              fields={[
                {
                  name: "role",
                  label: "Role",
                  options: config.roles,
                  wide: true,
                },
                {
                  name: "status",
                  label: "Status",
                  options: ["ACTIVE", "SUSPENDED"],
                  wide: true,
                },
              ]}
              onSubmit={(v) => save(`/users/${modal.row.id}`, v, patch)}
            />
          )}{" "}
          {modal.type === "audit" && (
            <>
              <h3>Previous values</h3>
              <pre>
                {JSON.stringify(modal.row.previous_value, null, 2) || "—"}
              </pre>
              <h3>New values</h3>
              <pre>{JSON.stringify(modal.row.new_value, null, 2) || "—"}</pre>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
