import React, { useState } from "react";
import { useData } from "../hooks";
import { post, get } from "../api";
import {
  Panel,
  Table,
  Form,
  Modal,
  Button,
  Loading,
  human,
} from "../components";
const opts = (items, key = "name") =>
  (items || []).map((r) => ({
    value: r.id,
    label: typeof key === "function" ? key(r) : r[key],
  }));
const person = (r) => `${r.first_name} ${r.last_name}`;
const reason = {
  name: "reason",
  label: "Reason for this change",
  type: "textarea",
  minLength: 5,
  wide: true,
};
const number = (name, label, min, max) => ({
  name,
  label,
  type: "number",
  min,
  max,
});
export function AcademicRecords({ setup, term, notify }) {
  const [classId, setClass] = useState(""),
    [modal, setModal] = useState(null),
    q = useData(
      classId && term
        ? `/academics/roster?class_id=${classId}&term_id=${term}`
        : null,
      null,
    ),
    exams = useData(term ? `/academics/exams?term_id=${term}` : null);
  const classes = setup.classes.filter(
      (c) =>
        c.academic_year_id ===
          setup.terms?.find((t) => t.id === Number(term))?.academic_year_id ||
        !setup.terms,
    ),
    subjects = setup.assignments.filter((s) => s.class_id === Number(classId));
  const close = () => setModal(null),
    done = () => {
      close();
      q.reload();
      exams.reload();
      notify("Academic record saved.");
    };
  return (
    <>
      <Panel
        title="Historical class records"
        description="Term rosters remain stable after transfers. Review inferred older rosters against your register; add missing students with a recorded reason."
      >
        <label className="field">
          Class
          <select value={classId} onChange={(e) => setClass(e.target.value)}>
            <option value="">Choose class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {q.error && <p className="form-error">{q.error}</p>}
        {classId && q.data && (
          <>
            <div className="toolbar">
              <Button onClick={() => setModal({ type: "roster" })}>
                Amend term roster
              </Button>
              <Button secondary onClick={() => setModal({ type: "policy" })}>
                Class grading policy
              </Button>
            </div>
            <p>
              Grading policy: {q.data.policy.label}. Changing finalized records
              requires reopening the report batch and unlocking a closed term.
            </p>
            <Table
              rows={q.data.students}
              columns={[
                { label: "Student", render: person },
                { label: "Number", key: "student_number" },
                { label: "Roster source", render: (r) => human(r.source) },
                {
                  label: "Subjects",
                  render: (r) =>
                    r.subject_ids
                      ? subjects
                          .filter((s) => r.subject_ids.includes(s.id))
                          .map((s) => s.subject_name)
                          .join(", ")
                      : "All class subjects",
                },
                {
                  label: "",
                  render: (r) => (
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "roster", row: r })}
                    >
                      Edit subjects / membership
                    </button>
                  ),
                },
              ]}
            />
          </>
        )}
      </Panel>
      <Panel
        title="Exam timetable"
        action={
          <Button onClick={() => setModal({ type: "exam" })}>
            Schedule exam
          </Button>
        }
      >
        {exams.error && <p className="form-error">{exams.error}</p>}
        <Table
          rows={exams.data}
          columns={[
            { label: "Class", key: "class_name" },
            { label: "Subject", key: "subject_name" },
            { label: "Date", key: "exam_date" },
            { label: "Time", render: (r) => `${r.start_time}–${r.end_time}` },
            { label: "Room", key: "room" },
            { label: "Invigilator", key: "invigilator_name" },
            {
              label: "",
              render: (r) => (
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "exam", row: r })}
                >
                  Reschedule
                </button>
              ),
            },
          ]}
        />
      </Panel>
      {modal && (
        <Modal
          title={
            {
              roster: "Amend term roster",
              policy: "Class grading policy",
              exam: "Schedule exam",
            }[modal.type]
          }
          onClose={close}
        >
          {modal.type === "roster" ? (
            <Form
              initial={{
                student_id: modal.row?.id,
                all_subjects: !modal.row?.subject_ids,
                ...Object.fromEntries(
                  subjects.map((s) => [
                    `subject_${s.id}`,
                    modal.row?.subject_ids?.includes(s.id) || false,
                  ]),
                ),
              }}
              fields={[
                {
                  name: "student_id",
                  label: "Student",
                  options: opts(q.data.candidates, person),
                },
                {
                  name: "excluded",
                  label: "Exclude from this term roster",
                  type: "checkbox",
                },
                {
                  name: "all_subjects",
                  label: "Take all class subjects",
                  type: "checkbox",
                },
                ...subjects.map((s) => ({
                  name: `subject_${s.id}`,
                  label: s.subject_name,
                  type: "checkbox",
                })),
                reason,
              ]}
              onSubmit={async (v) => {
                await post("/academics/roster", {
                  class_id: classId,
                  term_id: term,
                  student_id: v.student_id,
                  excluded: v.excluded,
                  subject_ids: v.all_subjects
                    ? null
                    : subjects
                        .filter((s) => v[`subject_${s.id}`])
                        .map((s) => s.id),
                  reason: v.reason,
                });
                done();
              }}
            />
          ) : modal.type === "policy" ? (
            <Form
              initial={{
                ...q.data.policy.policy,
                label: q.data.policy.label,
                scale: q.data.policy.policy.grading_scale
                  .map((g) => `${g.letter},${g.minimum},${g.points}`)
                  .join("\n"),
              }}
              fields={[
                { name: "label", label: "Policy name" },
                {
                  name: "scale",
                  label: "Grade, minimum %, GPA points (one grade per line)",
                  type: "textarea",
                  wide: true,
                },
                number("pass_mark", "Pass mark (%)", 0, 100),
                {
                  name: "ranking_enabled",
                  label: "Enable class ranking",
                  type: "checkbox",
                },
                { name: "gpa_enabled", label: "Enable GPA", type: "checkbox" },
                reason,
              ]}
              onSubmit={async (v) => {
                const scale = v.scale
                  .split("\n")
                  .filter((s) => s.trim())
                  .map((line) => {
                    const [letter, minimum, points] = line
                      .split(",")
                      .map((s) => s.trim());
                    return {
                      letter,
                      minimum: Number(minimum),
                      points: Number(points),
                    };
                  });
                await post("/academics/class-policy", {
                  class_id: classId,
                  term_id: term,
                  label: v.label,
                  reason: v.reason,
                  policy: {
                    ...q.data.policy.policy,
                    pass_mark: Number(v.pass_mark),
                    ranking_enabled: v.ranking_enabled,
                    gpa_enabled: v.gpa_enabled,
                    grading_scale: scale,
                  },
                });
                done();
              }}
            />
          ) : (
            <Form
              initial={modal.row || {}}
              fields={[
                {
                  name: "class_subject_id",
                  label: "Class and subject",
                  options: opts(
                    setup.assignments,
                    (s) => `${s.class_name} · ${s.subject_name}`,
                  ),
                },
                { name: "exam_date", label: "Exam date", type: "date" },
                { name: "start_time", label: "Start time", type: "time" },
                { name: "end_time", label: "End time", type: "time" },
                { name: "room", label: "Room" },
                {
                  name: "invigilator_id",
                  label: "Invigilator",
                  options: opts(setup.teachers),
                },
                reason,
              ]}
              onSubmit={async (v) => {
                await post("/academics/exams", {
                  ...v,
                  term_id: term,
                  ...(modal.row ? { id: modal.row.id } : {}),
                });
                done();
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
export function WorkCalendar({ notify }) {
  const q = useData("/hr/calendar", null);
  if (q.error) return <p className="form-error">{q.error}</p>;
  if (!q.data) return <Loading />;
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return (
    <Panel
      title="Working days and leave allowance"
      description="Applies to new approvals. Existing approvals retain the days recorded at approval. Allowance is per calendar year; public holidays are entered by your school."
    >
      <Form
        key={JSON.stringify(q.data)}
        initial={{
          ...q.data,
          ...Object.fromEntries(
            days.map((_, i) => [`day${i}`, q.data.weekdays.includes(i)]),
          ),
          holidays: q.data.holidays
            .map((h) => `${h.date},${h.name}`)
            .join("\n"),
        }}
        fields={[
          ...days.map((label, i) => ({
            name: `day${i}`,
            label,
            type: "checkbox",
          })),
          number(
            "annual_leave_days",
            "Annual leave allowance (working days)",
            0,
            366,
          ),
          {
            name: "holidays",
            label: "Holidays: YYYY-MM-DD, name (one per line)",
            type: "textarea",
            required: false,
            wide: true,
          },
          reason,
        ]}
        onSubmit={async (v) => {
          await post("/hr/calendar", {
            weekdays: days.flatMap((_, i) => (v[`day${i}`] ? [i] : [])),
            annual_leave_days: Number(v.annual_leave_days),
            holidays: v.holidays
              .split("\n")
              .filter((s) => s.trim())
              .map((s) => {
                const comma = s.indexOf(",");
                if (comma < 0)
                  throw Error(
                    "Each holiday needs a date and name separated by a comma.",
                  );
                return {
                  date: s.slice(0, comma).trim(),
                  name: s.slice(comma + 1).trim(),
                };
              }),
            reason: v.reason,
          });
          q.reload();
          notify("Work calendar saved.");
        }}
      />
    </Panel>
  );
}
export function StaffDocuments({ staff, onClose, notify }) {
  const q = useData(`/hr/staff/${staff.id}/documents`),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`Private HR documents · ${person(staff)}`} onClose={onClose}>
      <p>HR access only. PDF, PNG or JPEG, up to 4 MB each.</p>
      {(error || q.error) && <p className="form-error">{error || q.error}</p>}
      <Table
        rows={q.data}
        columns={[
          { label: "Document", key: "name" },
          { label: "Category", render: (r) => human(r.category) },
          {
            label: "",
            render: (r) => (
              <a href={`/api/v1/hr/documents/${r.id}`} download>
                Download
              </a>
            ),
          },
        ]}
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget;
          try {
            await post(`/hr/staff/${staff.id}/documents`, new FormData(form));
            form.reset();
            q.reload();
            notify("HR document uploaded.");
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Category
          <select name="category">
            {[
              "CONTRACT",
              "QUALIFICATION",
              "CERTIFICATION",
              "TRAINING",
              "OTHER",
            ].map((v) => (
              <option key={v} value={v}>
                {human(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Document
          <input
            name="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            required
          />
        </label>
        <Button disabled={busy}>Upload document</Button>
      </form>
    </Modal>
  );
}
export function ReviewAmendment({ review, onClose, onChange, notify }) {
  const q = useData(`/hr/reviews/${review.id}/history`);
  return (
    <Modal title="Amend performance review" onClose={onClose}>
      <p>
        Revision {review.revision}. Earlier evidence and scores remain in
        history. Saving recalculates the automatic measures from current
        records.
      </p>
      <Form
        initial={review}
        fields={[
          number(
            "development_score",
            "Professional development score (%)",
            0,
            100,
          ),
          {
            name: "notes",
            label: "Review evidence and notes",
            type: "textarea",
            wide: true,
          },
          reason,
        ]}
        onSubmit={async (v) => {
          await post(`/hr/reviews/${review.id}/amend`, {
            ...v,
            revision: review.revision,
          });
          onChange();
          onClose();
          notify("Review amended; previous revision retained.");
        }}
      />
      {q.error && <p className="form-error">{q.error}</p>}
      <Table
        rows={q.data}
        columns={[
          { label: "Revision", key: "revision" },
          { label: "Previous score", render: (r) => r.record.overall_score },
          { label: "Previous notes", render: (r) => r.record.notes },
          { label: "Amendment reason", key: "reason" },
        ]}
      />
    </Modal>
  );
}
export function ModelLab() {
  const q = useData("/intelligence/models", null),
    [kind, setKind] = useState("REVENUE"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(null);
  const example =
    kind === "REVENUE"
      ? "month,value"
      : "entity_key,snapshot_date,outcome_date,outcome," +
        (kind === "STUDENT_SUPPORT"
          ? "attendance_rate,average_score,prior_failures"
          : "attendance_rate,overdue_ratio,satisfaction_score");
  const csv = (content) => {
    const lines = content
        .trim()
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/),
      keys = lines
        .shift()
        .split(",")
        .map((s) => s.trim());
    if (keys.join(",") !== example) throw Error(`Expected columns: ${example}`);
    return lines.map((line) => {
      const cells = line.split(",").map((s) => s.trim());
      if (cells.length !== keys.length || cells.some((s) => !s))
        throw Error("Each row must contain a value for every column.");
      return Object.fromEntries(
        keys.map((k, i) => [
          k,
          ["month", "entity_key", "snapshot_date", "outcome_date"].includes(k)
            ? cells[i]
            : Number(cells[i]),
        ]),
      );
    });
  };
  return (
    <Panel
      title="Historical model evaluation"
      description="Import observed history, compare candidate models with simple baselines, and inspect held-out results. Evaluations do not enable production predictions."
    >
      {(error || q.error) && <p className="form-error">{error || q.error}</p>}
      <label className="field">
        Analysis
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {["REVENUE", "STUDENT_SUPPORT", "RETENTION"].map((v) => (
            <option key={v} value={v}>
              {human(v)}
            </option>
          ))}
        </select>
      </label>
      <p>
        {kind === "REVENUE"
          ? "Import at least 24 consecutive complete months. Values are cash receipts in the currency’s smallest unit (kobo for NGN). Include verified zero months."
          : "Use one pseudonymous observation per student or family. Features must be known on the snapshot date. Outcome 1 means subsequent academic failure (student support) or subsequent withdrawal (retention); outcome 0 means the outcome was observed and did not occur. Do not mark unknown outcomes as zero. Rates use 0–100; overdue ratio uses 0–1; satisfaction uses 1–5."}
      </p>
      <p>
        CSV columns: <code className="wrap">{example}</code>
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget,
            f = new FormData(form);
          try {
            const file = f.get("file");
            if (file.size > 900000) throw Error("Use a CSV under 900 KB.");
            await post("/intelligence/datasets", {
              kind,
              name: f.get("name"),
              source_note: f.get("source_note"),
              historical_observations_confirmed: f.get("confirmed") === "on",
              records: csv(await file.text()),
            });
            form.reset();
            q.reload();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Dataset name
          <input name="name" required />
        </label>
        <label className="field">
          Source, observation window and outcome definition
          <textarea name="source_note" minLength={20} required />
        </label>
        <label className="field">
          Historical CSV
          <input name="file" type="file" accept=".csv" required />
        </label>
        <label className="check-field">
          <input name="confirmed" type="checkbox" required />
          These are observed historical records from this school, with features
          recorded before their outcomes.
        </label>
        <Button disabled={busy}>Import historical data</Button>
      </form>
      <Table
        rows={q.data?.datasets || []}
        columns={[
          { label: "Dataset", key: "name" },
          { label: "Analysis", render: (r) => human(r.kind) },
          { label: "Records", key: "record_count" },
          {
            label: "",
            render: (r) => (
              <Button
                secondary
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const run = await post(
                      `/intelligence/datasets/${r.id}/evaluate`,
                      {},
                    );
                    setDetail(run);
                    q.reload();
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Evaluate
              </Button>
            ),
          },
        ]}
      />
      <Table
        rows={q.data?.runs || []}
        columns={[
          { label: "Run", key: "id" },
          { label: "Analysis", render: (r) => human(r.kind) },
          { label: "Result", render: (r) => human(r.status) },
          {
            label: "",
            render: (r) => (
              <button className="text-button" onClick={() => setDetail(r)}>
                View evidence
              </button>
            ),
          },
        ]}
      />
      {detail && (
        <Modal
          title={`Evaluation ${detail.id} · ${human(detail.status)}`}
          onClose={() => setDetail(null)}
        >
          <p>{detail.report.reason}</p>
          <p>{detail.report.gate}</p>
          <p>
            Production predictions: disabled. A passing historical gate is
            evidence for review, not proof of future accuracy.
          </p>
          <Table
            rows={Object.entries(detail.report)
              .filter(
                ([, v]) =>
                  v !== null &&
                  typeof v !== "object" &&
                  !["reason", "gate"].includes(v),
              )
              .map(([measure, value]) => ({
                measure: human(measure),
                value: String(value),
              }))}
            columns={[
              { label: "Measure", key: "measure" },
              { label: "Value", key: "value" },
            ]}
          />
          {detail.report.backtest && (
            <Table
              rows={detail.report.backtest}
              columns={[
                { label: "Month", key: "month" },
                { label: "Actual (minor units)", key: "actual" },
                { label: "Predicted (minor units)", key: "predicted" },
              ]}
            />
          )}{" "}
          {detail.report.calibration && (
            <Table
              rows={detail.report.calibration}
              columns={[
                { label: "Probability range", key: "range" },
                { label: "Count", key: "count" },
                { label: "Mean probability", key: "mean_probability" },
                { label: "Observed rate", key: "observed_rate" },
              ]}
            />
          )}{" "}
          {detail.report.counts && (
            <p>
              Training: {detail.report.counts.training}; tuning:{" "}
              {detail.report.counts.tuning}; test: {detail.report.counts.test};
              purged overlapping outcomes: {detail.report.counts.purged}.
            </p>
          )}
        </Modal>
      )}
    </Panel>
  );
}
