import { ModelLab } from "./refinements";
import React, { useEffect, useState } from "react";
import { TrendingUp, Users, Wallet, AlertCircle } from "lucide-react";
import { useData } from "../hooks";
import { post } from "../api";
import {
  PageHead,
  Panel,
  Table,
  Metric,
  Form,
  Modal,
  Button,
  Loading,
  human,
} from "../components";
export function Intelligence({ money, can }) {
  const q = useData("/intelligence", null);
  useEffect(() => {
    if (q.data && location.hash.endsWith("/models") && can("intelligence.manage"))
      document.getElementById("historical-model-evaluation")?.scrollIntoView();
  }, [q.data, can]);
  if (q.error) return <p className="form-error">{q.error}</p>;
  if (!q.data) return <Loading />;
  const d = q.data,
    f = d.forecast;
  return (
    <>
      <PageHead
        title="Management intelligence"
        description="Explore recorded trends, support needs and the evidence behind planning estimates."
      />
      <div className="metrics-grid">
        <Metric
          icon={Wallet}
          label="Next month’s receipt estimate"
          value={
            f.forecast_cents === null
              ? "Not available"
              : money(f.forecast_cents)
          }
          detail={
            f.status === "INSUFFICIENT_HISTORY"
              ? `${f.available_months} / 6 complete months available`
              : "Three-month mean baseline"
          }
        />
        <Metric
          icon={TrendingUp}
          label="Historical forecast error"
          value={f.mae_cents === null ? "Not available" : money(f.mae_cents)}
          detail={`Mean absolute error · ${f.validation_points} test months`}
        />
        <Metric
          icon={Users}
          label="Active linked families"
          value={d.families.active_families}
          detail={`${d.families.linked_families} families linked to records`}
        />
        <Metric
          icon={AlertCircle}
          label="Withdrawn students"
          value={d.families.withdrawn_students}
          detail="Current records; not a prediction"
        />
      </div>
      <Panel title="Forecast evidence">
        <div className="notice">
          {f.status === "INSUFFICIENT_HISTORY"
            ? "At least six complete calendar months of recorded receipts are needed before a baseline can be evaluated. No forecast has been generated."
            : "This baseline is tested against subsequent historical months using only earlier observations. Its measured error is not a future confidence interval."}
        </div>
        <Table
          rows={f.backtest || []}
          columns={[
            { label: "Test month", key: "month" },
            { label: "Estimated receipts", render: (r) => money(r.predicted) },
            { label: "Actual receipts", render: (r) => money(r.actual) },
          ]}
          empty={{
            title: "Awaiting historical data",
            description:
              "Real receipt history will populate these comparisons.",
          }}
        />
      </Panel>
      <div className="academic-grid">
        <Panel title="Recorded receipts by month">
          <Table
            rows={d.revenue_history}
            columns={[
              { label: "Month", key: "month" },
              { label: "Receipts", render: (r) => money(r.value) },
            ]}
            empty={{ title: "No complete receipt history" }}
          />
        </Panel>
        <Panel title="New enrollment trend">
          <Table
            rows={d.enrollment}
            columns={[
              { label: "Month", key: "month" },
              { label: "First enrollments", key: "students" },
            ]}
            empty={{ title: "No enrollment history" }}
          />
        </Panel>
        <Panel title="Academic support indicators">
          <Table
            rows={d.risk}
            columns={[
              { label: "Reason", render: (r) => human(r.reason) },
              { label: "Students", key: "students" },
            ]}
            empty={{ title: "No open academic support flags" }}
          />
        </Panel>
        <Panel title="Quality and facilities">
          <Table
            rows={[
              {
                name: "Parent satisfaction / 5",
                value: d.operations.satisfaction_score ?? "No responses",
              },
              { name: "Open complaints", value: d.operations.open_complaints },
              {
                name: "Open maintenance issues",
                value: d.operations.maintenance_open,
              },
              { name: "Urgent repairs", value: d.operations.urgent_repairs },
              {
                name: "Recorded maintenance spend",
                value: money(d.operations.maintenance_cost_cents),
              },
            ]}
            columns={[
              { label: "Measure", key: "name" },
              { label: "Value", key: "value" },
            ]}
          />
        </Panel>
      </div>
      {can("intelligence.manage") && (
        <div id="historical-model-evaluation">
          <ModelLab />
        </div>
      )}
      <Panel title="How to interpret this page">
        <ul>
          {d.limitations.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
export function Platform({ notify }) {
  const q = useData("/platform/schools"),
    [create, setCreate] = useState(false);
  return (
    <>
      <PageHead
        title="Schools"
        description="Provision isolated school workspaces. Each school administrator manages their own school."
        action={null}
      >
        <Button onClick={() => setCreate(true)}>Add school</Button>
      </PageHead>
      {q.error && <p className="form-error">{q.error}</p>}
      <Panel
        title="School portfolio"
        description="This view contains school summaries. Student, financial and personnel records remain within each school’s account."
      >
        <Table
          rows={q.data}
          columns={[
            { label: "School", key: "name" },
            { label: "Code", key: "short_code" },
            { label: "Currency", key: "currency_code" },
            { label: "Enrolled", key: "enrolled" },
            { label: "Active accounts", key: "active_accounts" },
          ]}
        />
      </Panel>
      {create && (
        <Modal
          title="Provision school workspace"
          onClose={() => setCreate(false)}
        >
          <Form
            fields={[
              { name: "name", label: "School name" },
              { name: "short_code", label: "School code", maxLength: 12 },
              { name: "currency_code", label: "Currency", default: "NGN" },
              { name: "timezone", label: "Timezone", default: "Africa/Lagos" },
              { name: "admin_name", label: "School administrator name" },
              {
                name: "admin_email",
                label: "School administrator email",
                type: "email",
              },
              {
                name: "admin_password",
                label: "Initial administrator password",
                type: "password",
                minLength: 12,
                wide: true,
              },
              { name: "year_name", label: "Academic year", wide: true },
              { name: "start_date", label: "Year start", type: "date" },
              { name: "end_date", label: "Year end", type: "date" },
            ]}
            onSubmit={async (v) => {
              await post("/platform/schools", v);
              setCreate(false);
              q.reload();
              notify(
                "School created. Its administrator can sign in and configure term dates.",
              );
            }}
            submit="Create school"
          >
            <p className="muted">
              The new administrator receives school access only. Share the
              initial credentials securely. Review the initial term dates after
              signing in.
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
export function IntegrationReadiness() {
  const q = useData("/integrations/readiness", null);
  return (
    <Panel title="Production integration readiness">
      {q.error ? (
        <p className="form-error">{q.error}</p>
      ) : q.data ? (
        <>
          <Table
            rows={[
              {
                name: "Application address",
                value: q.data.app_url || "Not configured",
              },
              {
                name: "HTTPS address",
                value: q.data.https ? "Configured" : "Pending",
              },
              {
                name: "Email service",
                value: q.data.email_configured
                  ? "Configured; delivery must be verified"
                  : "Pending SMTP and sender",
              },
              {
                name: "PostgreSQL server",
                value: q.data.postgresql_configured
                  ? "Configured"
                  : "Local database",
              },
              {
                name: "Secure cookies",
                value: q.data.secure_cookies
                  ? "Enabled"
                  : "Supabase configuration required",
              },
              { name: "Backups", value: q.data.backup_storage },
            ]}
            columns={[
              { label: "Integration", key: "name" },
              { label: "Status", key: "value" },
            ]}
          />
          <p className="muted">{q.data.deployment}</p>
        </>
      ) : (
        <Loading />
      )}
    </Panel>
  );
}
