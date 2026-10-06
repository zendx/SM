import { AcademicRecords } from "./refinements";
import React, { useEffect, useState } from "react";
import {
  Plus,
  Save,
  Download,
  BookOpen,
  GraduationCap,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { api, get, post, patch } from "../api";
import { useData } from "../hooks";
import {
  PageHead,
  Panel,
  Button,
  Table,
  Person,
  Badge,
  Modal,
  Form,
  Metric,
  Empty,
  Loading,
  human,
} from "../components";

export async function downloadAcademic(path, name) {
  const response = await fetch(`/api/v1${path}`);
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.errors?.[0]?.message || "Download failed.");
  }
  const url = URL.createObjectURL(await response.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const assignmentOptions = (assignments) =>
  assignments.map((a) => ({
    value: a.id,
    label: `${a.class_name} · ${a.subject_name}`,
  }));
const classOptions = (classes) =>
  classes.map((c) => ({ value: c.id, label: c.name }));
const assessmentFields = (assignments, today) => [
  {
    name: "class_subject_id",
    label: "Class and subject",
    options: assignmentOptions(assignments),
    wide: true,
  },
  { name: "name", label: "Assessment name", placeholder: "Mathematics CA 1" },
  {
    name: "type",
    label: "Assessment type",
    options: ["ASSIGNMENT", "TEST", "CA", "PRACTICAL", "PROJECT", "EXAM"],
    default: "CA",
  },
  {
    name: "max_score",
    label: "Maximum score",
    type: "number",
    min: 0.01,
    max: 10000,
    step: 0.01,
    default: 100,
  },
  {
    name: "weight_percent",
    label: "Term weight (%)",
    type: "number",
    min: 0.01,
    max: 100,
    step: 0.01,
  },
  {
    name: "assessment_date",
    label: "Assessment date",
    type: "date",
    default: today,
    wide: true,
  },
];

function ScoreEntry({ assessment, onClose, notify }) {
  const q = useData(`/assessments/${assessment.id}/scores`, null),
    [values, setValues] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (q.data)
      setValues(
        Object.fromEntries(q.data.students.map((s) => [s.id, s.score ?? ""])),
      );
  }, [q.data]);
  async function save() {
    setError("");
    setBusy(true);
    try {
      await post(`/assessments/${assessment.id}/scores`, {
        scores: q.data.students.map((s) => ({
          student_id: s.id,
          score: values[s.id] === "" ? null : Number(values[s.id]),
        })),
      });
      notify("Scores saved.");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Score entry · ${assessment.name}`} onClose={onClose}>
      {q.loading ? (
        <Loading />
      ) : q.error ? (
        <p className="form-error">{q.error}</p>
      ) : (
        <>
          <div className="notice">
            Maximum: {q.data.assessment.max_score} · Term weight:{" "}
            {q.data.assessment.weight_percent}%. Blank scores remain unrecorded.
          </div>
          {q.data.locked && (
            <div className="form-error">{q.data.lock_reason}</div>
          )}
          <Table
            rows={q.data.students}
            columns={[
              {
                label: "Student",
                render: (s) => (
                  <Person
                    first={s.first_name}
                    last={s.last_name}
                    sub={s.student_number}
                  />
                ),
              },
              {
                label: "Score",
                render: (s) => (
                  <input
                    className="score-input"
                    aria-label={`Score for ${s.first_name} ${s.last_name}`}
                    type="number"
                    min={0}
                    max={q.data.assessment.max_score}
                    step="0.01"
                    disabled={q.data.locked}
                    value={values[s.id] ?? ""}
                    onChange={(e) =>
                      setValues({ ...values, [s.id]: e.target.value })
                    }
                  />
                ),
              },
              {
                label: "Grade preview",
                render: (s) => {
                  const value = values[s.id];
                  if (value === "" || value === undefined) return "—";
                  const percent =
                    Math.round(
                      (Number(value) / Number(q.data.assessment.max_score)) *
                        10000,
                    ) / 100;
                  return percent < 0 || percent > 100
                    ? "Invalid"
                    : q.data.policy.grading_scale.find(
                        (g) => percent >= Number(g.minimum),
                      )?.letter || "—";
                },
              },
            ]}
          />
          {error && <div className="form-error">{error}</div>}
          <div className="form-footer">
            <Button
              disabled={q.data.locked || busy || !q.data.students.length}
              onClick={save}
            >
              <Save size={16} />
              {busy ? "Saving…" : "Save scores"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
function ReportDetail({ id, onClose, user, notify, onChange }) {
  const [revision, setRevision] = useState("");
  const history = useData(
    !["PARENT", "STUDENT"].includes(user.role)
      ? `/report-cards/${id}/revisions`
      : null,
  );
  const q = useData(
    `/report-cards/${id}${revision ? `?revision=${revision}` : ""}`,
    null,
  );
  return (
    <Modal title="Student report card" onClose={onClose}>
      {history.data?.length > 0 && (
        <label className="field">
          Report version
          <select
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
          >
            <option value="">Current version</option>
            {history.data.map((h) => (
              <option key={h.revision} value={h.revision}>
                Archived revision {h.revision} ? {h.reason}
              </option>
            ))}
          </select>
        </label>
      )}
      {revision && <p className="notice">Archived report ? read only.</p>}
      {q.error ? (
        <p className="form-error">{q.error}</p>
      ) : !q.data ? (
        <Loading />
      ) : (
        <>
          <div className="report-heading">
            <div>
              <h2>{q.data.snapshot.student.name}</h2>
              <p>
                {q.data.snapshot.class_name} · {q.data.snapshot.term_name} ·{" "}
                {q.data.snapshot.year_name}
              </p>
            </div>
            <Badge value={q.data.status} />
          </div>
          <Table
            rows={q.data.snapshot.subjects}
            keyField="class_subject_id"
            columns={[
              { label: "Subject", key: "subject_name" },
              { label: "Total", render: (s) => `${s.total}%` },
              { label: "Grade", key: "grade" },
              {
                label: "Outcome",
                render: (s) => (
                  <Badge value={s.passed ? "PASS" : "BELOW_PASS_MARK"} />
                ),
              },
            ]}
          />
          <div className="report-totals">
            <strong>Average: {q.data.overall_average}%</strong>
            <span>Grade: {q.data.overall_grade}</span>
            {q.data.gpa !== null && <span>GPA: {q.data.gpa}</span>}
            {q.data.class_rank !== null && (
              <span>Class rank: {q.data.class_rank}</span>
            )}
          </div>
          <p className="muted">
            Attendance:{" "}
            {q.data.snapshot.attendance.percentage === null
              ? "Not recorded"
              : `${q.data.snapshot.attendance.percentage}%`}
            . Revision {q.data.revision}.
          </p>
          <Button
            secondary
            onClick={async () => {
              try {
                await downloadAcademic(
                  `/report-cards/${id}?format=pdf${revision ? `&revision=${revision}` : ""}`,
                  `report-${id}.pdf`,
                );
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <Download size={16} />
            Download PDF
          </Button>
          {!revision &&
          q.data.status === "DRAFT" &&
          !["PARENT", "STUDENT"].includes(user.role) ? (
            <>
              <h3 className="section-title">Report comments</h3>
              <Form
                initial={q.data}
                fields={[
                  {
                    name: "teacher_comment",
                    label: "Teacher comment",
                    type: "textarea",
                    required: false,
                    wide: true,
                  },
                  ...(user.role === "TEACHER"
                    ? []
                    : [
                        {
                          name: "principal_comment",
                          label: "Principal comment",
                          type: "textarea",
                          required: false,
                          wide: true,
                        },
                      ]),
                ]}
                onSubmit={async (v) => {
                  await patch(`/report-cards/${id}/comments`, {
                    ...v,
                    principal_comment:
                      v.principal_comment ?? q.data.principal_comment,
                  });
                  q.reload();
                  onChange();
                  notify("Report comments saved.");
                }}
                submit="Save comments"
              />
            </>
          ) : (
            <div className="profile-details section-title">
              <div>
                <small>Teacher comment</small>
                <strong>{q.data.teacher_comment || "—"}</strong>
              </div>
              <div>
                <small>Principal comment</small>
                <strong>{q.data.principal_comment || "—"}</strong>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
function ReportsTab({ term, classes, can, user, notify }) {
  const own = can("reports.academic.own") && !can("reports.academic.read"),
    batches = useData(!own ? `/report-batches?term_id=${term}` : null),
    cards = useData(`/report-cards?term_id=${term}`),
    [modal, setModal] = useState(null),
    [selected, setSelected] = useState(null),
    [busy, setBusy] = useState(false);
  async function change(path, body) {
    setBusy(true);
    try {
      await post(path, body);
      batches.reload();
      cards.reload();
      setModal(null);
      notify("Report workflow updated.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!own && (
        <Panel
          title="Class report batches"
          description="Generate a draft, review comments, finalize results, then publish to families."
          action={
            can("reports.generate") && (
              <Button small onClick={() => setModal({ type: "generate" })}>
                <Plus size={15} />
                Generate reports
              </Button>
            )
          }
        >
          {batches.error && <p className="form-error">{batches.error}</p>}
          <Table
            rows={batches.data}
            columns={[
              { label: "Class", key: "class_name" },
              { label: "Students", key: "students" },
              { label: "Status", render: (b) => <Badge value={b.status} /> },
              { label: "Revision", key: "revision" },
              {
                label: "Actions",
                render: (b) => (
                  <div className="row-actions">
                    {b.status === "DRAFT" && can("reports.finalize") && (
                      <Button
                        small
                        disabled={busy}
                        onClick={async () => {
                          try {
                            await change(
                              `/report-batches/${b.id}/finalize`,
                              {},
                            );
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        Finalize results
                      </Button>
                    )}
                    {b.status === "FINALIZED" && can("reports.publish") && (
                      <Button
                        small
                        disabled={busy}
                        onClick={async () => {
                          try {
                            await change(`/report-batches/${b.id}/publish`, {});
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        Publish reports
                      </Button>
                    )}
                    {b.status !== "DRAFT" &&
                      can("reports.finalize") &&
                      (b.status !== "PUBLISHED" || can("reports.publish")) && (
                        <button
                          className="text-button"
                          onClick={() => setModal({ type: "reopen", row: b })}
                        >
                          Reopen batch
                        </button>
                      )}
                  </div>
                ),
              },
            ]}
            empty={{
              title: "Reports start with complete results",
              description:
                "Set up subjects and assessments, then record every student’s scores.",
            }}
          />
        </Panel>
      )}
      <Panel
        title={own ? "Published report cards" : "Student report cards"}
        description={
          own
            ? "Only published results for linked students appear here."
            : "Drafts are visible to academic leaders and the class teacher."
        }
      >
        {cards.error && <p className="form-error">{cards.error}</p>}
        <Table
          rows={cards.data}
          columns={[
            {
              label: "Student",
              render: (s) => (
                <Person
                  first={s.first_name}
                  last={s.last_name}
                  sub={s.class_name}
                />
              ),
            },
            { label: "Average", render: (s) => `${s.overall_average}%` },
            { label: "Grade", key: "overall_grade" },
            { label: "Status", render: (s) => <Badge value={s.status} /> },
            {
              label: "Report",
              render: (s) => (
                <button
                  className="text-button"
                  onClick={() => setSelected(s.id)}
                >
                  View report
                </button>
              ),
            },
          ]}
          empty={{
            title: own
              ? "No published results yet"
              : "No report cards generated",
            description: own
              ? "The school will publish completed reports here."
              : "Generate a class report batch after completing all scores.",
          }}
        />
      </Panel>
      {selected && (
        <ReportDetail
          id={selected}
          user={user}
          notify={notify}
          onClose={() => setSelected(null)}
          onChange={cards.reload}
        />
      )}{" "}
      {modal && (
        <Modal
          title={
            modal.type === "generate"
              ? "Generate class reports"
              : "Reopen report batch"
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "generate" ? (
            <Form
              fields={[
                {
                  name: "class_id",
                  label: "Class",
                  options: classOptions(classes),
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                change("/report-cards/generate", { ...v, term_id: term })
              }
              submit="Generate drafts"
            >
              <p className="muted">
                Every subject must have 100% assessment weight and complete
                marks for all enrolled students.
              </p>
            </Form>
          ) : (
            <Form
              fields={[
                {
                  name: "reason",
                  label: "Reason for reopening",
                  type: "textarea",
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                change(`/report-batches/${modal.row.id}/reopen`, v)
              }
              submit="Reopen as draft"
            >
              <div className="notice">
                Published reports will be withdrawn from family accounts until
                the revised batch is finalized and published again. Closed terms
                still need an administrator unlock for score changes.
              </div>
            </Form>
          )}
        </Modal>
      )}
    </>
  );
}
function AnalyticsTab({ term, setup, can, notify }) {
  const [filters, setFilters] = useState({
      class_id: "",
      subject_id: "",
      teacher_user_id: "",
    }),
    [selected, setSelected] = useState(null);
  const query = new URLSearchParams({
    term_id: term,
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const q = useData(`/analytics/academics?${query}`, null),
    risks = useData(
      can("analytics.read")
        ? `/analytics/academics/at-risk?term_id=${term}`
        : null,
    );
  const summary = q.data?.summary;
  return (
    <>
      <Panel>
        <div className="table-toolbar">
          {[
            ["class_id", "Class", classOptions(setup.classes)],
            [
              "subject_id",
              "Subject",
              setup.subjects.map((s) => ({ value: s.id, label: s.name })),
            ],
            [
              "teacher_user_id",
              "Teacher",
              [
                ...new Map(
                  setup.assignments.map((a) => [
                    a.teacher_user_id,
                    { value: a.teacher_user_id, label: a.teacher_name },
                  ]),
                ).values(),
              ],
            ],
          ].map(([key, label, options]) => (
            <label className="inline-field" key={key}>
              {label}
              <select
                aria-label={`Analytics ${label.toLowerCase()}`}
                value={filters[key]}
                onChange={(e) =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              >
                <option value="">
                  All{" "}
                  {label === "Class" ? "classes" : `${label.toLowerCase()}s`}
                </option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Panel>
      {q.error && <p className="form-error">{q.error}</p>}
      {summary && (
        <div className="metrics-grid">
          <Metric
            label="Academic average"
            value={summary.average === null ? "—" : `${summary.average}%`}
            detail="Completed subject results"
            icon={GraduationCap}
          />
          <Metric
            label="Pass rate"
            value={summary.pass_rate === null ? "—" : `${summary.pass_rate}%`}
            detail="Uses configured pass mark"
            icon={CheckCircle2}
          />
          <Metric
            label="Complete results"
            value={summary.completed}
            detail="Student / subject results"
            icon={BookOpen}
          />
          <Metric
            label="Incomplete results"
            value={summary.incomplete}
            detail="Missing scores or weight"
            icon={AlertCircle}
          />
        </div>
      )}
      <div className="notice">
        Averages include completed subject results only. Current-term values may
        be provisional; term trends use finalized snapshots. The same filters
        apply to averages, comparisons and trends.
      </div>
      {q.data && (
        <>
          <div className="academic-grid">
            {[
              ["classes", "Class performance", "class_name"],
              ["subjects", "Subject performance", "subject_name"],
              ["teachers", "Teacher indicators", "teacher_name"],
            ].map(([key, title, name]) => (
              <Panel title={title} key={key}>
                <Table
                  rows={q.data[key]}
                  columns={[
                    { label: "Name", key: name },
                    {
                      label: "Average",
                      render: (r) =>
                        r.average === null ? "—" : `${r.average}%`,
                    },
                    {
                      label: "Pass rate",
                      render: (r) =>
                        r.pass_rate === null ? "—" : `${r.pass_rate}%`,
                    },
                    {
                      label: "Complete",
                      render: (r) => `${r.completed}/${r.records}`,
                    },
                  ]}
                />
              </Panel>
            ))}
            <Panel
              title="Term-over-term performance"
              description="Finalized results in chronological order"
            >
              <Table
                rows={q.data.trend}
                columns={[
                  { label: "Term", key: "term_name" },
                  { label: "Average", render: (r) => `${r.average}%` },
                  { label: "Pass rate", render: (r) => `${r.pass_rate}%` },
                ]}
              />
            </Panel>
          </div>
          {q.data.students && (
            <Panel title="Individual subject performance">
              <Table
                rows={q.data.students}
                keyField="unused"
                columns={[
                  { label: "Student", key: "student_name" },
                  { label: "Class", key: "class_name" },
                  { label: "Subject", key: "subject_name" },
                  {
                    label: "Result",
                    render: (r) =>
                      r.complete ? `${r.total}% · ${r.grade}` : "Incomplete",
                  },
                  {
                    label: "Source",
                    render: (r) =>
                      r.finalized ? "Finalized report" : "Current gradebook",
                  },
                ]}
              />
            </Panel>
          )}
        </>
      )}
      {can("analytics.read") && (
        <Panel
          title="Students needing academic support"
          description="Flags are evaluated when reports are finalized. Teachers see their homeroom students."
        >
          {risks.error && <p className="form-error">{risks.error}</p>}
          <Table
            rows={risks.data.filter(
              (r) =>
                !filters.class_id || r.class_id === Number(filters.class_id),
            )}
            columns={[
              {
                label: "Student",
                render: (r) => (
                  <Person
                    first={r.first_name}
                    last={r.last_name}
                    sub={r.class_name}
                  />
                ),
              },
              {
                label: "Reason",
                render: (r) => (
                  <div>
                    {human(r.reason)}
                    <small className="block muted wrap">{r.detail}</small>
                  </div>
                ),
              },
              { label: "Status", render: (r) => <Badge value={r.status} /> },
              {
                label: "Intervention",
                render: (r) =>
                  r.status === "OPEN" ? (
                    <button
                      className="text-button"
                      onClick={() => setSelected(r)}
                    >
                      Resolve with note
                    </button>
                  ) : (
                    <span className="wrap">{r.resolution_note}</span>
                  ),
              },
            ]}
            empty={{
              title: "No academic risk flags",
              description:
                "Repeated failure, grade decline, and low attendance with poor results are evaluated from finalized reports.",
            }}
          />
        </Panel>
      )}
      <AcademicExports term={term} notify={notify} />
      {selected && (
        <Modal
          title="Resolve academic risk flag"
          onClose={() => setSelected(null)}
        >
          <Form
            fields={[
              {
                name: "note",
                label: "Intervention / resolution note",
                type: "textarea",
                wide: true,
              },
            ]}
            onSubmit={async (v) => {
              await patch(
                `/analytics/academics/at-risk/${selected.id}/resolve`,
                v,
              );
              setSelected(null);
              risks.reload();
              notify("Academic risk flag resolved.");
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function AcademicExports({ term, notify, curriculum = false }) {
  const [format, setFormat] = useState("csv");
  return (
    <Panel
      title="Export academic reports"
      description="Exports use the selected term and your assigned access scope."
    >
      <div className="table-toolbar">
        <select
          aria-label="Academic report format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="csv">CSV</option>
          <option value="xlsx">Excel</option>
          <option value="pdf">PDF</option>
        </select>
        {(curriculum
          ? ["curriculum"]
          : ["classes", "subjects", "teachers"]
        ).map((key) => (
          <Button
            secondary
            small
            key={key}
            onClick={async () => {
              try {
                await downloadAcademic(
                  `/academics/reports/${key}?term_id=${term}&format=${format}`,
                  `${key}-term-${term}.${format}`,
                );
                notify("Academic report exported.");
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <Download size={14} />
            {human(key)}
          </Button>
        ))}
      </div>
    </Panel>
  );
}

function SetupTab({ setup, term, config, can, notify, reload }) {
  const [modal, setModal] = useState(null),
    policy = setup.policy;
  async function save(path, v, method = post) {
    await method(path, v);
    setModal(null);
    reload();
    notify("Academic setup saved.");
  }
  return (
    <>
      <div className="academic-grid">
        <Panel
          title="Subjects"
          action={
            <Button small onClick={() => setModal("subject")}>
              <Plus size={14} />
              Add subject
            </Button>
          }
        >
          <Table
            rows={setup.subjects}
            columns={[
              { label: "Subject", key: "name" },
              { label: "Code", key: "code" },
              { label: "Department", key: "department" },
            ]}
          />
        </Panel>
        <Panel
          title="Teaching assignments"
          description="Only the assigned teacher may enter this subject’s scores."
          action={
            <Button small onClick={() => setModal("assignment")}>
              <Plus size={14} />
              Assign subject
            </Button>
          }
        >
          <Table
            rows={setup.assignments}
            columns={[
              { label: "Class", key: "class_name" },
              { label: "Subject", key: "subject_name" },
              { label: "Teacher", key: "teacher_name" },
              { label: "Credits", key: "credits" },
            ]}
          />
        </Panel>
      </div>
      <Panel
        title="Grading and academic policy"
        description="Changes apply to calculations going forward. Finalized report snapshots retain the policy used at finalization."
      >
        <div className="settings-form">
          <Form
            key={JSON.stringify(policy)}
            initial={{
              ...policy,
              grading_scale: policy.grading_scale
                .map((g) => `${g.letter},${g.minimum},${g.points}`)
                .join("\n"),
            }}
            fields={[
              {
                name: "grading_scale",
                label: "Grading scale",
                type: "textarea",
                wide: true,
                hint: "One grade per line: letter, minimum percentage, GPA points. Include a threshold of 0.",
              },
              {
                name: "pass_mark",
                label: "Pass mark (%)",
                type: "number",
                min: 0,
                max: 100,
                step: 0.01,
              },
              {
                name: "decline_threshold",
                label: "Grade decline alert (points)",
                type: "number",
                min: 0.01,
                max: 100,
                step: 0.01,
              },
              {
                name: "repeated_failure_terms",
                label: "Consecutive failing terms",
                type: "number",
                min: 2,
                max: 6,
              },
              {
                name: "risk_attendance_threshold",
                label: "Low attendance threshold (%)",
                type: "number",
                min: 1,
                max: 100,
              },
              {
                name: "curriculum_lag_weeks",
                label: "Curriculum delay tolerance (weeks)",
                type: "number",
                min: 0,
                max: 12,
              },
              {
                name: "ranking_enabled",
                label: "Show class rank on reports",
                type: "checkbox",
              },
              {
                name: "gpa_enabled",
                label: "Calculate GPA on reports",
                type: "checkbox",
              },
            ]}
            onSubmit={async (v) => {
              const grading_scale = v.grading_scale
                .split(/\r?\n/)
                .filter((line) => line.trim())
                .map((line) => {
                  const cells = line.split(",").map((x) => x.trim());
                  if (cells.length !== 3)
                    throw new Error(
                      "Each grade line needs letter, minimum percentage, and GPA points.",
                    );
                  return {
                    letter: cells[0],
                    minimum: Number(cells[1]),
                    points: Number(cells[2]),
                  };
                });
              await save("/academics/settings", { ...v, grading_scale }, patch);
            }}
            submit="Save academic policy"
          />
        </div>
      </Panel>
      {can("admin.write") && (
        <Panel
          title="Term entry controls"
          description="Date-based locks apply after the term end. An explicit unlock can temporarily reopen score entry."
        >
          <div className="settings-form">
            <Form
              key={term}
              initial={
                setup.controls.find((c) => c.term_id === Number(term)) || {}
              }
              fields={[
                {
                  name: "closed",
                  label: "Close this term for score entry",
                  type: "checkbox",
                },
                {
                  name: "unlock_until",
                  label: "Temporarily unlock until",
                  type: "date",
                  required: false,
                },
                {
                  name: "reason",
                  label: "Reason for this change",
                  type: "textarea",
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                save(
                  `/academics/terms/${term}/control`,
                  { ...v, unlock_until: v.unlock_until || null },
                  patch,
                )
              }
              submit="Save term control"
            />
            <p className="muted">
              Finalized report batches must also be reopened before editing
              scores.
            </p>
            <details className="details-box">
              <summary>Link a student portal account</summary>
              <Form
                fields={[
                  {
                    name: "student_id",
                    label: "Student record ID",
                    type: "number",
                    min: 1,
                  },
                  {
                    name: "user_id",
                    label: "Student user account ID",
                    type: "number",
                    min: 1,
                  },
                ]}
                onSubmit={(v) => save("/academics/student-account", v)}
                submit="Link student account"
              />
            </details>
          </div>
        </Panel>
      )}
      {modal && (
        <Modal
          title={
            modal === "subject" ? "Create subject" : "Assign subject to class"
          }
          onClose={() => setModal(null)}
        >
          <Form
            fields={
              modal === "subject"
                ? [
                    { name: "name", label: "Subject name" },
                    { name: "code", label: "Subject code" },
                    {
                      name: "department",
                      label: "Department",
                      wide: true,
                      default: "General",
                    },
                  ]
                : [
                    {
                      name: "class_id",
                      label: "Class",
                      options: classOptions(setup.classes),
                    },
                    {
                      name: "subject_id",
                      label: "Subject",
                      options: setup.subjects.map((s) => ({
                        value: s.id,
                        label: s.name,
                      })),
                    },
                    {
                      name: "teacher_user_id",
                      label: "Teacher",
                      options: setup.teachers.map((t) => ({
                        value: t.id,
                        label: t.name,
                      })),
                    },
                    {
                      name: "credits",
                      label: "Subject credits",
                      type: "number",
                      min: 0.01,
                      max: 20,
                      step: 0.01,
                      default: 1,
                    },
                  ]
            }
            onSubmit={(v) =>
              save(modal === "subject" ? "/subjects" : "/class-subjects", v)
            }
            submit={modal === "subject" ? "Create subject" : "Save assignment"}
          >
            <p className="muted">
              {modal === "assignment"
                ? "Saving an existing class/subject updates its teacher and credits."
                : ""}
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
export function Academics({ user, can, term, config, notify }) {
  const own = can("reports.academic.own") && !can("academics.read"),
    setup = useData(!own ? "/academics/setup" : null, null),
    assessments = useData(
      can("academics.read") ? `/assessments?term_id=${term}` : null,
    );
  const tabs = [
    ["assessments", can("academics.read")],
    ["gradebook", can("academics.read")],
    ["report cards", can("reports.academic.read") || own],
    ["analytics", can("analytics.read") || can("analytics.summary")],
    ["setup", can("academics.manage")],
    ["records", can("academics.manage")],
  ]
    .filter(([, show]) => show)
    .map(([name]) => name);
  const [tab, setTab] = useState(() => {
      const requested = location.hash.slice(1).split("/")[1];
      return tabs.includes(requested) ? requested : tabs[0];
    }),
    [modal, setModal] = useState(null),
    [selectedClass, setSelectedClass] = useState(""),
    [assignment, setAssignment] = useState("");
  const yearId = config.terms.find(
      (t) => t.id === Number(term),
    )?.academic_year_id,
    classes = (setup.data?.classes || []).filter(
      (c) => c.academic_year_id === yearId,
    ),
    assignments = (setup.data?.assignments || []).filter(
      (a) => a.academic_year_id === yearId,
    );
  useEffect(() => {
    if (!classes.some((c) => String(c.id) === selectedClass))
      setSelectedClass(String(classes[0]?.id || ""));
  }, [setup.data, term]);
  const gradebook = useData(
    tab === "gradebook" && selectedClass
      ? `/academics/gradebook?class_id=${selectedClass}&term_id=${term}`
      : null,
    null,
  );
  async function saveAssessment(v) {
    await (modal.row
      ? patch(`/assessments/${modal.row.id}`, { ...v, term_id: term })
      : post("/assessments", { ...v, term_id: term }));
    setModal(null);
    assessments.reload();
    gradebook.reload();
    notify("Assessment saved.");
  }
  return (
    <>
      <PageHead
        eyebrow="LEARNING & PROGRESS"
        title={own ? "Academic results" : "Academics"}
        description={
          own
            ? "Published school reports, securely available to your family."
            : "From daily assessment to a clear picture of every learner’s progress."
        }
      >
        {tab === "assessments" && can("assessments.write") && (
          <Button onClick={() => setModal({ type: "assessment" })}>
            <Plus size={17} />
            New assessment
          </Button>
        )}
      </PageHead>
      <div className="tabs">
        {tabs.map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {human(t)}
          </button>
        ))}
      </div>
      {setup.error && <p className="form-error">{setup.error}</p>}
      {!own && !setup.data ? (
        <Loading />
      ) : (
        <>
          {tab === "assessments" && (
            <Panel
              title="Assessments & examinations"
              description="Assessment weights must total 100% per subject before report generation."
              action={
                <select
                  aria-label="Filter assessments by subject"
                  value={assignment}
                  onChange={(e) => setAssignment(e.target.value)}
                >
                  <option value="">All class subjects</option>
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.class_name} · {a.subject_name}
                    </option>
                  ))}
                </select>
              }
            >
              {assessments.error && (
                <p className="form-error">{assessments.error}</p>
              )}
              <Table
                rows={assessments.data.filter(
                  (a) =>
                    !assignment || a.class_subject_id === Number(assignment),
                )}
                columns={[
                  {
                    label: "Assessment",
                    render: (a) => (
                      <div>
                        <strong>{a.name}</strong>
                        <small className="block muted">
                          {a.class_name} · {a.subject_name}
                        </small>
                      </div>
                    ),
                  },
                  { label: "Type", render: (a) => <Badge value={a.type} /> },
                  { label: "Maximum", key: "max_score" },
                  { label: "Weight", render: (a) => `${a.weight_percent}%` },
                  { label: "Scores entered", key: "entered" },
                  {
                    label: "Actions",
                    render: (a) => (
                      <div className="row-actions">
                        <Button
                          small
                          secondary
                          onClick={() => setModal({ type: "scores", row: a })}
                        >
                          Enter scores
                        </Button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({ type: "assessment", row: a })
                          }
                        >
                          Edit
                        </button>
                        {a.entered === 0 && (
                          <button
                            className="text-button muted"
                            onClick={() => setModal({ type: "delete", row: a })}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ),
                  },
                ]}
                empty={{
                  title: "Build a balanced assessment plan",
                  description:
                    "Add subjects and teaching assignments in Setup, then create assessments for the selected term.",
                }}
              />
            </Panel>
          )}
          {tab === "gradebook" && (
            <Panel
              title="Class gradebook"
              description="Blank or incomplete results remain ungraded."
              action={
                <select
                  aria-label="Gradebook class"
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                >
                  <option value="">Select class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              }
            >
              {gradebook.error && (
                <p className="form-error">{gradebook.error}</p>
              )}
              {gradebook.data ? (
                <Table
                  rows={gradebook.data.students}
                  columns={[
                    {
                      label: "Student",
                      render: (s) => (
                        <Person
                          first={s.first_name}
                          last={s.last_name}
                          sub={s.student_number}
                        />
                      ),
                    },
                    ...gradebook.data.assignments.map((a) => ({
                      label: a.subject_name,
                      render: (s) => {
                        const subject = s.subjects.find(
                          (x) => x.class_subject_id === a.id,
                        );
                        return subject?.complete
                          ? `${subject.total}% · ${subject.grade}`
                          : "Incomplete";
                      },
                    })),
                    {
                      label:
                        user.role === "TEACHER"
                          ? "Assigned subject average"
                          : "Overall average",
                      render: (s) =>
                        s.complete ? `${s.overall_average}%` : "Incomplete",
                    },
                  ]}
                />
              ) : (
                <Empty title="Select a class to view results" />
              )}
            </Panel>
          )}
          {tab === "report cards" && (
            <ReportsTab
              term={term}
              classes={classes}
              can={can}
              user={user}
              notify={notify}
            />
          )}{" "}
          {tab === "analytics" && setup.data && (
            <AnalyticsTab
              key={term}
              term={term}
              setup={{ ...setup.data, classes }}
              can={can}
              notify={notify}
            />
          )}{" "}
          {tab === "records" && setup.data && (
            <AcademicRecords
              setup={{ ...setup.data, classes }}
              term={term}
              notify={notify}
            />
          )}
          {tab === "setup" && setup.data && (
            <SetupTab
              setup={setup.data}
              term={term}
              config={config}
              can={can}
              notify={notify}
              reload={setup.reload}
            />
          )}
        </>
      )}
      {modal?.type === "scores" && (
        <ScoreEntry
          assessment={modal.row}
          notify={notify}
          onClose={() => {
            setModal(null);
            assessments.reload();
            gradebook.reload();
          }}
        />
      )}
      {modal?.type === "assessment" && (
        <Modal
          title={modal.row ? "Edit assessment" : "Create assessment"}
          onClose={() => setModal(null)}
        >
          <Form
            initial={modal.row || {}}
            fields={assessmentFields(assignments, config.today)}
            onSubmit={saveAssessment}
            submit="Save assessment"
          />
        </Modal>
      )}
      {modal?.type === "delete" && (
        <Modal title="Remove empty assessment" onClose={() => setModal(null)}>
          <p>
            Remove “{modal.row.name}”? Assessments with recorded scores cannot
            be removed.
          </p>
          <Form
            fields={[]}
            onSubmit={async () => {
              await api(`/assessments/${modal.row.id}`, { method: "DELETE" });
              setModal(null);
              assessments.reload();
              notify("Empty assessment removed.");
            }}
            submit="Remove assessment"
          />
        </Modal>
      )}
    </>
  );
}
