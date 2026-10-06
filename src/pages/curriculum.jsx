import React, { useState } from "react";
import {
  Plus,
  Upload,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { useData } from "../hooks";
import { get, post, patch } from "../api";
import {
  PageHead,
  Panel,
  Button,
  Table,
  Badge,
  Modal,
  Form,
  Metric,
  Loading,
  human,
} from "../components";
import { AcademicExports } from "./academics";

export function Curriculum({ can, term, config, notify }) {
  const setup = useData("/academics/setup", null),
    topics = useData(
      can("curriculum.read") ? `/curriculum/topics?term_id=${term}` : null,
    ),
    summary = useData(`/curriculum/dashboard?term_id=${term}`, null),
    [tab, setTab] = useState(can("curriculum.read") ? "topics" : "coverage"),
    [filter, setFilter] = useState(""),
    [modal, setModal] = useState(null);
  const yearId = config.terms.find(
      (t) => t.id === Number(term),
    )?.academic_year_id,
    assignments = (setup.data?.assignments || []).filter(
      (a) => a.academic_year_id === yearId,
    ),
    opts = assignments.map((a) => ({
      value: a.id,
      label: `${a.class_name} · ${a.subject_name}`,
    })),
    s = summary.data?.summary;
  async function save(path, v, method = post) {
    const result = await method(path, v);
    setModal(null);
    topics.reload();
    summary.reload();
    notify(
      result.imported
        ? `${result.imported} curriculum topics imported.`
        : "Curriculum record saved.",
    );
  }
  async function history(topic) {
    try {
      setModal({
        type: "history",
        row: topic,
        history: await get(`/curriculum/topics/${topic.id}/history`),
      });
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="TEACHING & DELIVERY"
        title="Curriculum"
        description="Connect the teaching plan with what happens in the classroom."
      >
        {can("curriculum.manage") && (
          <>
            <Button secondary onClick={() => setModal({ type: "import" })}>
              <Upload size={16} />
              Import CSV
            </Button>
            <Button onClick={() => setModal({ type: "topic" })}>
              <Plus size={16} />
              Plan topic
            </Button>
          </>
        )}
      </PageHead>
      {s && (
        <div className="metrics-grid">
          <Metric
            label="Planned topics"
            value={s.planned}
            detail="Selected academic term"
            icon={BookOpen}
          />
          <Metric
            label="Completed"
            value={s.completed}
            detail="Fully taught topics"
            icon={CheckCircle2}
          />
          <Metric
            label="Coverage"
            value={s.coverage_percent === null ? "—" : `${s.coverage_percent}%`}
            detail="Completed / planned topics"
            icon={TrendingUp}
            tone="accent"
          />
          <Metric
            label="Behind schedule"
            value={s.behind}
            detail="Beyond configured tolerance"
            icon={AlertCircle}
          />
        </div>
      )}
      <div className="tabs">
        {[...(can("curriculum.read") ? ["topics"] : []), "coverage"].map(
          (t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {human(t)}
            </button>
          ),
        )}
      </div>
      {[setup.error, topics.error, summary.error]
        .filter(Boolean)
        .map((error, i) => (
          <p key={i} className="form-error">
            {error}
          </p>
        ))}
      {tab === "topics" ? (
        <Panel
          title="Teaching plan"
          description="Completion follows the latest teaching-date entry. Partial topics need a reason."
          action={
            <select
              aria-label="Curriculum class subject"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All class subjects</option>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        >
          <Table
            rows={topics.data.filter(
              (t) => !filter || t.class_subject_id === Number(filter),
            )}
            columns={[
              {
                label: "Topic",
                render: (t) => (
                  <div>
                    <strong>{t.topic_name}</strong>
                    <small className="block muted">
                      {t.class_name} · {t.subject_name}
                    </small>
                  </div>
                ),
              },
              { label: "Week", key: "planned_week" },
              { label: "Sequence", key: "sequence_order" },
              {
                label: "Status",
                render: (t) => (
                  <div>
                    <Badge value={t.completion_status} />
                    {t.behind && (
                      <small className="block behind-label">
                        Behind schedule
                      </small>
                    )}
                  </div>
                ),
              },
              {
                label: "Teaching log",
                render: (t) => (
                  <div className="row-actions">
                    {can("curriculum.write") && (
                      <Button
                        small
                        secondary
                        onClick={() => setModal({ type: "log", row: t })}
                      >
                        Log teaching
                      </Button>
                    )}
                    <button className="text-button" onClick={() => history(t)}>
                      History
                    </button>
                    {can("curriculum.manage") && (
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "topic", row: t })}
                      >
                        Edit plan
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            empty={{
              title: "Start with a clear teaching plan",
              description:
                "Add topics with a planned week and sequence, or import the term plan from CSV.",
            }}
          />
        </Panel>
      ) : summary.data ? (
        <>
          <Panel title="Coverage by class and subject">
            <Table
              rows={summary.data.subjects}
              columns={[
                { label: "Class", key: "class_name" },
                { label: "Subject", key: "subject_name" },
                { label: "Teacher", key: "teacher_name" },
                { label: "Planned", key: "planned" },
                { label: "Completed", key: "completed" },
                {
                  label: "Coverage",
                  render: (r) => (
                    <div className="coverage-cell">
                      <span>{r.coverage_percent}%</span>
                      <div className="progress-track">
                        <span style={{ width: `${r.coverage_percent}%` }} />
                      </div>
                    </div>
                  ),
                },
                {
                  label: "Status",
                  render: (r) => (
                    <Badge value={r.behind ? "BEHIND_SCHEDULE" : "ON_TRACK"} />
                  ),
                },
              ]}
            />
          </Panel>
          <div className="academic-grid">
            {[
              ["teachers", "Teacher comparison", "teacher_name"],
              ["departments", "Department coverage", "department"],
            ].map(([key, title, label]) => (
              <Panel key={key} title={title}>
                <Table
                  rows={summary.data[key]}
                  columns={[
                    { label: "Name", key: label },
                    {
                      label: "Completed",
                      render: (r) => `${r.completed}/${r.planned}`,
                    },
                    {
                      label: "Coverage",
                      render: (r) => `${r.coverage_percent}%`,
                    },
                    { label: "Delayed topics", key: "behind" },
                  ]}
                />
              </Panel>
            ))}
          </div>
          <AcademicExports curriculum term={term} notify={notify} />
        </>
      ) : (
        <Loading />
      )}
      {modal && (
        <Modal
          title={
            {
              topic: modal.row
                ? "Edit curriculum topic"
                : "Plan curriculum topic",
              import: "Import curriculum topics",
              log: "Record teaching coverage",
              history: "Topic teaching history",
            }[modal.type]
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "topic" && (
            <Form
              initial={modal.row || {}}
              fields={[
                {
                  name: "class_subject_id",
                  label: "Class and subject",
                  options: opts,
                  wide: true,
                },
                { name: "topic_name", label: "Topic name", wide: true },
                {
                  name: "planned_week",
                  label: "Planned week",
                  type: "number",
                  min: 1,
                  max: 53,
                },
                {
                  name: "sequence_order",
                  label: "Sequence order",
                  type: "number",
                  min: 1,
                  max: 10000,
                },
              ]}
              onSubmit={(v) =>
                save(
                  modal.row
                    ? `/curriculum/topics/${modal.row.id}`
                    : "/curriculum/topics",
                  { ...v, term_id: term },
                  modal.row ? patch : post,
                )
              }
              submit="Save topic"
            />
          )}
          {modal.type === "import" && (
            <>
              <div className="notice">
                CSV headers: <code>topic_name,planned_week,sequence_order</code>
                . Up to 500 topics. Duplicate sequence numbers reject the entire
                import.
              </div>
              <ImportForm
                options={opts}
                onSubmit={(v) =>
                  save("/curriculum/topics/import", { ...v, term_id: term })
                }
              />
            </>
          )}
          {modal.type === "log" && (
            <>
              <h3>{modal.row.topic_name}</h3>
              <Form
                fields={[
                  {
                    name: "date_taught",
                    label: "Date taught",
                    type: "date",
                    default: config.today,
                  },
                  {
                    name: "lesson_duration_minutes",
                    label: "Duration (minutes)",
                    type: "number",
                    min: 0,
                    max: 600,
                    default: 40,
                  },
                  {
                    name: "completion_status",
                    label: "Completion status",
                    options: ["COMPLETED", "PARTIAL", "NOT_STARTED"],
                    wide: true,
                  },
                  {
                    name: "reason_for_noncompletion",
                    label: "Reason if incomplete",
                    type: "textarea",
                    required: false,
                    wide: true,
                  },
                ]}
                onSubmit={(v) =>
                  save("/curriculum/coverage-logs", {
                    ...v,
                    curriculum_topic_id: modal.row.id,
                  })
                }
                submit="Save teaching log"
              />
            </>
          )}
          {modal.type === "history" && (
            <>
              <h3>{modal.row.topic_name}</h3>
              <Table
                rows={modal.history}
                columns={[
                  { label: "Date taught", key: "date_taught" },
                  {
                    label: "Status",
                    render: (l) => <Badge value={l.completion_status} />,
                  },
                  { label: "Minutes", key: "lesson_duration_minutes" },
                  { label: "Logged by", key: "teacher_name" },
                  { label: "Reason", key: "reason_for_noncompletion" },
                ]}
              />
            </>
          )}
        </Modal>
      )}
    </>
  );
}
function ImportForm({ options, onSubmit }) {
  const [csv, setCsv] = useState("topic_name,planned_week,sequence_order\n"),
    [error, setError] = useState("");
  return (
    <>
      <label className="upload-box">
        <Upload size={18} />
        Choose a CSV file
        <input
          aria-label="Curriculum CSV file"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files[0];
            if (file) {
              if (file.size > 100000) {
                setError("CSV must be smaller than 100 KB.");
                return;
              }
              setCsv(await file.text());
              setError("");
            }
          }}
        />
      </label>
      <Form
        fields={[
          {
            name: "class_subject_id",
            label: "Class and subject",
            options,
            wide: true,
          },
        ]}
        onSubmit={(v) => onSubmit({ ...v, csv })}
        submit="Import topics"
      >
        <label className="field">
          <span>CSV content</span>
          <textarea
            rows={8}
            aria-label="CSV content"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
      </Form>
    </>
  );
}
