import React, { useState } from "react";
import { useData } from "../hooks";
import { patch } from "../api";
import { PageHead, Panel, Table, Badge, human } from "../components";
export function openAlert(alert, go) {
  const page =
    {
      FINANCE: "finance",
      ATTENDANCE: "attendance",
      DISCIPLINE: "quality",
      PARENT: "quality",
      FACILITIES: "facilities",
      ACADEMIC: "academics",
      CURRICULUM: "curriculum",
    }[alert.category] || "dashboard";
  if (["PARENT", "FACILITIES"].includes(alert.category)) {
    const params = new URLSearchParams();
    params.set("case_id", alert.entity_id);
    params.set(
      "case_kind",
      alert.category === "PARENT" ? "COMPLAINT" : "MAINTENANCE",
    );
    history.replaceState(
      null,
      "",
      `${location.pathname}?${params}${location.hash}`,
    );
  }
  go(page);
}
export function ManagementAlerts({ go, notify }) {
  const q = useData("/alerts"),
    [category, setCategory] = useState(""),
    [severity, setSeverity] = useState("");
  return (
    <>
      <PageHead
        title="Management alerts"
        description="Prioritized issues across the school. Alerts clear automatically when their source condition is resolved."
      />
      {q.error && <p className="form-error">{q.error}</p>}
      <Panel>
        <div className="table-toolbar">
          <label className="inline-field">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {[...new Set(q.data.map((a) => a.category))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">All priorities</option>
              {["URGENT", "HIGH", "NORMAL", "LOW"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <Table
          rows={q.data.filter(
            (a) =>
              (!category || a.category === category) &&
              (!severity || a.severity === severity),
          )}
          columns={[
            { label: "Priority", render: (r) => <Badge value={r.severity} /> },
            { label: "Category", render: (r) => human(r.category) },
            {
              label: "Issue",
              render: (r) => (
                <button
                  className="text-button wrap"
                  onClick={() => openAlert(r, go)}
                >
                  {r.message}
                </button>
              ),
            },
            { label: "Status", render: (r) => <Badge value={r.status} /> },
            {
              label: "",
              render: (r) =>
                r.status === "ACTIVE" && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await patch(`/alerts/${r.id}/acknowledge`, {});
                        q.reload();
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  >
                    Acknowledge
                  </button>
                ),
            },
          ]}
          empty={{
            title: "No matching alerts",
            description:
              "New issues appear when their configured conditions are met.",
          }}
        />
      </Panel>
    </>
  );
}
