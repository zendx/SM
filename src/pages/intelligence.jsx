import { ModelLab } from "./refinements";
import React, { useEffect } from "react";
import { TrendingUp, Users, Wallet, AlertCircle } from "lucide-react";
import { useData } from "../hooks";
import { PageHead, Panel, Table, Metric, Loading, human } from "../components";
export function Intelligence({ money, can }) {
  const q = useData("/intelligence", null);
  useEffect(() => {
    if (
      q.data &&
      location.hash.endsWith("/models") &&
      can("intelligence.manage")
    )
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
        description="See attendance, fees and academic trends to help you plan and follow up."
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
