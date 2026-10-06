import { WorkCalendar, StaffDocuments, ReviewAmendment } from "./refinements";
import React, { useState, useEffect } from "react";
import { ClipboardList, Users, Wrench, Heart, TrendingUp } from "lucide-react";
import { useData } from "../hooks";
import { get, post, patch } from "../api";
import {
  PageHead,
  Panel,
  Table,
  Form,
  Modal,
  Button,
  Badge,
  Metric,
  Loading,
  human,
} from "../components";
const opts = (data, label = "name") =>
  (data || []).map((v) => ({
    value: v.id,
    label: typeof label === "function" ? label(v) : v[label],
  }));
const person = (s) => `${s.first_name} ${s.last_name}`;
const memo = (name, label, required = true) => ({
  name,
  label,
  type: "textarea",
  wide: true,
  required,
});
const choice = (name, label, options, required = true) => ({
  name,
  label,
  options,
  required,
});
const txt = (name, label, required = true) => ({ name, label, required });
const day = (name, label, value) => ({
  name,
  label,
  type: "date",
  default: value,
});
const nfield = (name, label, min, max, def) => ({
  name,
  label,
  type: "number",
  min,
  max,
  default: def,
});
function Editor({ title, fields, initial, onSave, onClose, submit = "Save" }) {
  return (
    <Modal title={title} onClose={onClose}>
      <Form
        fields={fields}
        initial={initial}
        onSubmit={onSave}
        submit={submit}
      />
    </Modal>
  );
}
function Errors({ queries }) {
  return queries.map((q, i) =>
    q.error ? (
      <p key={i} className="form-error">
        {q.error}
      </p>
    ) : null,
  );
}
function CaseDetail({
  record,
  setup,
  user,
  can,
  onClose,
  onChange,
  notify,
  money,
}) {
  const q = useData(`/operations/cases/${record.id}`, null),
    [mode, setMode] = useState("history");
  if (!q.data)
    return (
      <Modal title="Case history" onClose={onClose}>
        {q.error || <Loading />}
      </Modal>
    );
  const c = q.data,
    next =
      setup.workflows[c.kind][setup.workflows[c.kind].indexOf(c.stage) + 1];
  const manager = can(
    {
      DISCIPLINE: "discipline.manage",
      COMPLAINT: "complaints.manage",
      MAINTENANCE: "facilities.manage",
    }[c.kind],
  );
  const canAdvance =
    next === "PARENT_FEEDBACK"
      ? c.parent_user_id === user.id
      : manager || (c.kind === "COMPLAINT" && c.assigned_to === user.id);
  async function save(v) {
    if (mode === "assign") await patch(`/operations/cases/${c.id}/assign`, v);
    else
      await post(`/operations/cases/${c.id}/stage`, {
        ...v,
        stage: next,
        feedback_score: v.feedback_score ? Number(v.feedback_score) : undefined,
      });
    q.reload();
    onChange();
    setMode("history");
    notify("Case updated.");
  }
  const fields =
    mode === "assign"
      ? [choice("assigned_to", "Responsible staff", opts(setup.users))]
      : [
          memo(
            "note",
            next === "PARENT_NOTIFICATION"
              ? "Contact method, recipient and notification record"
              : next === "CLOSED"
                ? "Follow-up and closure notes"
                : "Progress note (visible in case history)",
          ),
          ...(next === "ACTION_TAKEN"
            ? [choice("action_type", "Action taken", setup.disciplineActions)]
            : []),
          ...(next === "COST_RECORDED"
            ? [{ ...nfield("cost", "Repair cost", 0, undefined), step: 0.01 }]
            : []),
          ...(next === "PARENT_FEEDBACK"
            ? [nfield("feedback_score", "Resolution rating (1–5)", 1, 5, 5)]
            : []),
        ];
  return (
    <Modal title={`CASE-${c.id} · ${human(c.kind)}`} onClose={onClose}>
      <p className="wrap">{c.description}</p>
      <div className="report-totals">
        <Badge value={c.stage} />
        <span>{human(c.category)}</span>
        <span>{human(c.priority)}</span>
        {c.cost_cents !== null && <span>{money(c.cost_cents)}</span>}
      </div>
      {c.due_at && (
        <p>Response target: {new Date(c.due_at).toLocaleString()}</p>
      )}
      {mode === "history" ? (
        <>
          <div className="toolbar">
            {manager && (
              <Button secondary onClick={() => setMode("assign")}>
                Assign case
              </Button>
            )}
            {next && canAdvance && (
              <Button onClick={() => setMode("advance")}>
                Next: {human(next)}
              </Button>
            )}
          </div>
          <Table
            rows={c.history}
            columns={[
              { label: "Stage", render: (r) => human(r.to_stage) },
              { label: "By", key: "actor_name" },
              {
                label: "Note",
                render: (r) => <span className="wrap">{r.note}</span>,
              },
              {
                label: "Date",
                render: (r) => new Date(r.created_at).toLocaleString(),
              },
            ]}
            empty={{
              title: "Case received",
              description: "Progress updates will appear here.",
            }}
          />
        </>
      ) : (
        <>
          <Form
            key={mode}
            fields={fields}
            onSubmit={save}
            submit={mode === "assign" ? "Save assignment" : "Record progress"}
          />
          <Button secondary onClick={() => setMode("history")}>
            Back to history
          </Button>
        </>
      )}
    </Modal>
  );
}
function Cases({ kind, setup, user, can, config, notify, money }) {
  const q = useData(`/operations/cases?kind=${kind}`),
    [modal, setModal] = useState(false),
    [selected, setSelected] = useState(null),
    [filter, setFilter] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(location.search),
      wanted = Number(params.get("case_id"));
    if (wanted && params.get("case_kind") === kind) {
      const record = q.data.find((c) => c.id === wanted);
      if (record) {
        setSelected(record);
        params.delete("case_id");
        params.delete("case_kind");
        history.replaceState(
          null,
          "",
          location.pathname + (params.size ? "?" + params : "") + location.hash,
        );
      }
    }
  }, [q.data, kind]);
  const canCreate =
    kind === "COMPLAINT"
      ? user.role === "PARENT" || can("complaints.manage")
      : kind === "DISCIPLINE"
        ? can("discipline.report") || can("discipline.manage")
        : can("operations.staff");
  const fields = [
    choice("category", "Category", setup.categories[kind]),
    memo("description", "Description"),
    day("event_date", "Event date", config.today),
    choice("priority", "Priority", ["LOW", "NORMAL", "HIGH", "URGENT"]),
    ...(kind === "DISCIPLINE"
      ? [choice("student_id", "Student", opts(setup.students, person))]
      : []),
    ...(kind === "COMPLAINT"
      ? [
          ...(user.role !== "PARENT"
            ? [choice("parent_user_id", "Parent", opts(setup.parents))]
            : []),
          choice(
            "student_id",
            "Student (optional)",
            opts(setup.students, person),
            false,
          ),
        ]
      : []),
    ...(kind === "MAINTENANCE"
      ? [
          choice("facility_id", "Facility", opts(setup.facilities)),
          choice(
            "asset_id",
            "Asset (optional)",
            opts(setup.assets, "asset_code"),
            false,
          ),
        ]
      : []),
  ];
  return (
    <>
      <Errors queries={[q]} />
      <Panel
        title={`${human(kind)} cases`}
        action={
          canCreate && (
            <Button onClick={() => setModal(true)}>
              New {kind.toLowerCase()}
            </Button>
          )
        }
      >
        <div className="toolbar">
          <label className="inline-field">
            Stage
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All stages</option>
              {setup.workflows[kind].map((s) => (
                <option key={s} value={s}>
                  {human(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Table
          rows={q.data.filter((c) => !filter || c.stage === filter)}
          columns={[
            { label: "Reference", render: (r) => `CASE-${r.id}` },
            {
              label: "Category",
              render: (r) => (
                <>
                  <strong>{human(r.category)}</strong>
                  <small className="block muted">
                    {r.first_name ? person(r) : r.facility_name}
                  </small>
                </>
              ),
            },
            { label: "Priority", render: (r) => <Badge value={r.priority} /> },
            { label: "Stage", render: (r) => <Badge value={r.stage} /> },
            {
              label: "Assigned",
              render: (r) => r.assignee_name || "Unassigned",
            },
            {
              label: "",
              render: (r) => (
                <button className="text-button" onClick={() => setSelected(r)}>
                  View case
                </button>
              ),
            },
          ]}
          empty={{
            title: "No cases recorded",
            description: "Create a case to begin its review workflow.",
          }}
        />
      </Panel>
      {modal && (
        <Editor
          title={`New ${kind.toLowerCase()}`}
          fields={fields}
          onClose={() => setModal(false)}
          onSave={async (v) => {
            await post("/operations/cases", { ...v, kind });
            setModal(false);
            q.reload();
            notify("Case recorded.");
          }}
          submit="Submit case"
        />
      )}
      {selected && (
        <CaseDetail
          record={selected}
          setup={setup}
          user={user}
          can={can}
          onClose={() => setSelected(null)}
          onChange={q.reload}
          notify={notify}
          money={money}
        />
      )}
    </>
  );
}
function Surveys({ can, user, config, notify }) {
  const q = useData("/surveys"),
    [modal, setModal] = useState(null),
    [result, setResult] = useState(null);
  async function results(s) {
    try {
      setResult(await get(`/surveys/${s.id}/results`));
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <Errors queries={[q]} />
      <Panel
        title="Parent satisfaction"
        description="Ratings use 1 (very dissatisfied) to 5 (very satisfied)."
        action={
          can("complaints.manage") && (
            <Button onClick={() => setModal({ type: "new" })}>
              Create survey
            </Button>
          )
        }
      >
        <Table
          rows={q.data}
          columns={[
            { label: "Survey", key: "title" },
            { label: "Opens", key: "start_date" },
            { label: "Closes", key: "end_date" },
            {
              label: "Status",
              render: (r) => (r.published ? "Published" : "Draft"),
            },
            {
              label: "",
              render: (r) =>
                user.role === "PARENT" ? (
                  r.responded ? (
                    "Answered"
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "answer", row: r })}
                    >
                      Answer survey
                    </button>
                  )
                ) : (
                  <>
                    {" "}
                    {!r.published && can("complaints.manage") && (
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "edit", row: r })}
                      >
                        Edit / publish
                      </button>
                    )}
                    <button className="text-button" onClick={() => results(r)}>
                      View results
                    </button>
                  </>
                ),
            },
          ]}
          empty={{
            title: "No surveys yet",
            description: "Published surveys will appear here.",
          }}
        />
      </Panel>
      {modal && (
        <Editor
          title={
            modal.type !== "answer"
              ? "Create satisfaction survey"
              : modal.row.title
          }
          onClose={() => setModal(null)}
          fields={
            modal.type !== "answer"
              ? [
                  ...(modal.type === "edit"
                    ? [memo("reason", "Reason for amendment")]
                    : []),
                  txt("title", "Survey title"),
                  memo("questions", "Questions, one per line"),
                  day("start_date", "Start date", config.today),
                  day("end_date", "End date", config.today),
                  {
                    name: "published",
                    label: "Publish survey",
                    type: "checkbox",
                    default: true,
                  },
                ]
              : modal.row.questions.map((label, i) =>
                  choice(
                    `q${i}`,
                    label,
                    [1, 2, 3, 4, 5].map((n) => ({
                      value: n,
                      label: String(n),
                    })),
                  ),
                )
          }
          initial={
            modal.type === "edit"
              ? { ...modal.row, questions: modal.row.questions.join("\n") }
              : modal.type !== "answer"
                ? {
                    questions:
                      "Teaching quality\nCommunication\nSafety\nFacilities\nTransportation\nValue for money\nOverall satisfaction",
                  }
                : {}
          }
          onSave={async (v) => {
            if (modal.type !== "answer")
              await (modal.type === "edit" ? patch : post)(
                modal.type === "edit" ? `/surveys/${modal.row.id}` : "/surveys",
                {
                  ...v,
                  questions: v.questions
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              );
            else
              await post(`/surveys/${modal.row.id}/responses`, {
                answers: modal.row.questions.map((_, i) => Number(v[`q${i}`])),
              });
            setModal(null);
            q.reload();
            notify("Survey saved.");
          }}
          submit={
            modal.type === "edit"
              ? "Save survey"
              : modal.type === "new"
                ? "Create survey"
                : "Submit answers"
          }
        />
      )}
      {result && (
        <Modal title={result.title} onClose={() => setResult(null)}>
          <p>{result.responses} parent responses</p>
          <Table
            rows={result.questions}
            columns={[
              { label: "Question", key: "question" },
              {
                label: "Average / 5",
                render: (r) => r.average ?? "No responses",
              },
            ]}
          />
        </Modal>
      )}
    </>
  );
}
function OperationsPolicy({ setup, notify, onChange }) {
  const s = setup.settings;
  return (
    <Panel
      title="Workflow policy"
      description="Response targets, discipline alerts and staff review weights are configurable."
    >
      <Form
        initial={{
          ...s,
          ...Object.fromEntries(
            Object.entries(s.review_weights).map(([k, v]) => [
              `weight_${k}`,
              v,
            ]),
          ),
        }}
        fields={[
          nfield(
            "complaint_sla_hours",
            "Complaint response target (hours)",
            1,
            720,
          ),
          nfield("discipline_threshold", "Repeat incident threshold", 2, 100),
          nfield(
            "discipline_window_days",
            "Repeat incident window (days)",
            1,
            365,
          ),
          ...["attendance", "punctuality", "curriculum", "development"].map(
            (k) => nfield(`weight_${k}`, `${human(k)} weight (%)`, 0, 100),
          ),
        ]}
        onSubmit={async (v) => {
          await patch("/operations/settings", {
            ...v,
            review_weights: Object.fromEntries(
              ["attendance", "punctuality", "curriculum", "development"].map(
                (k) => [k, Number(v[`weight_${k}`])],
              ),
            ),
          });
          onChange();
          notify("Workflow policy saved.");
        }}
        submit="Save workflow policy"
      />
    </Panel>
  );
}
function RepeatedIncidents({ config, setup }) {
  const [from, setFrom] = useState(`${config.today.slice(0, 4)}-01-01`),
    [to, setTo] = useState(config.today),
    [category, setCategory] = useState("");
  const q = useData(
    `/operations/discipline/repeated?from=${from}&to=${to}&category=${category}`,
  );
  return (
    <Panel
      title="Repeated discipline incidents"
      description="Students with at least two recorded incidents in the selected period. This is a review aid; decisions require investigation."
    >
      <div className="table-toolbar">
        <label className="inline-field">
          Incident report from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="inline-field">
          Incident report to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="inline-field">
          Incident type
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {setup.categories.DISCIPLINE.map((c) => (
              <option key={c} value={c}>
                {human(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Errors queries={[q]} />
      <Table
        rows={q.data}
        columns={[
          { label: "Student", render: person },
          { label: "Incidents", key: "incidents" },
        ]}
        empty={{ title: "No repeated incidents in this period" }}
      />
    </Panel>
  );
}
export function Quality(props) {
  const { can, user, config, notify } = props,
    setup = useData("/operations/setup", null),
    tabs = [
      ...(can("discipline.manage") || can("discipline.report")
        ? ["discipline"]
        : []),
      ...(can("operations.staff") || can("experience.own")
        ? ["complaints"]
        : []),
      ...(can("complaints.manage") ||
      can("experience.own") ||
      can("operations.summary")
        ? ["surveys"]
        : []),
      ...(can("admin.write") ? ["policy"] : []),
    ],
    [tab, setTab] = useState(
      new URLSearchParams(location.search).get("case_kind") === "COMPLAINT" &&
        tabs.includes("complaints")
        ? "complaints"
        : tabs[0],
    );
  return (
    <>
      <PageHead
        eyebrow="CARE & ACCOUNTABILITY"
        title="School experience"
        description="Track concerns, resolve incidents and listen to families."
      />
      <Errors queries={[setup]} />
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {human(t)}
          </button>
        ))}
      </div>
      {setup.data &&
        (tab === "surveys" ? (
          <Surveys can={can} user={user} config={config} notify={notify} />
        ) : tab === "policy" ? (
          <OperationsPolicy
            setup={setup.data}
            notify={notify}
            onChange={setup.reload}
          />
        ) : (
          <Cases
            key={tab}
            {...props}
            setup={setup.data}
            kind={tab === "discipline" ? "DISCIPLINE" : "COMPLAINT"}
          />
        ))}
      {setup.data && tab === "discipline" && can("discipline.manage") && (
        <RepeatedIncidents config={config} setup={setup.data} />
      )}
    </>
  );
}
export function Facilities(props) {
  const { can, notify, config, money } = props,
    setup = useData("/operations/setup", null),
    [tab, setTab] = useState("maintenance"),
    [modal, setModal] = useState(null);
  const data = setup.data;
  async function save(v) {
    if (modal.type === "condition")
      await patch(`/${modal.table}/${modal.row.id}`, v);
    else await post(`/${modal.type}`, v);
    setModal(null);
    setup.reload();
    notify("Facilities record saved.");
  }
  const fields =
    modal?.type === "condition"
      ? [
          choice("condition", "Condition", [
            "GOOD",
            "FAIR",
            "POOR",
            "OUT_OF_SERVICE",
          ]),
        ]
      : modal?.type === "facilities"
        ? [
            txt("name", "Facility name"),
            choice("category", "Facility category", [
              "CLASSROOM",
              "LABORATORY",
              "LIBRARY",
              "DORMITORY",
              "BUS",
              "SPORTS",
              "OFFICE",
              "GENERATOR",
              "OTHER",
            ]),
            txt("location", "Location"),
            choice("condition", "Condition", [
              "GOOD",
              "FAIR",
              "POOR",
              "OUT_OF_SERVICE",
            ]),
            choice(
              "responsible_user_id",
              "Responsible person",
              opts(data?.users),
              false,
            ),
          ]
        : [
            choice("facility_id", "Facility", opts(data?.facilities)),
            txt("asset_code", "Asset ID"),
            memo("description", "Asset description"),
            day("purchase_date", "Purchase date", config.today),
            { ...nfield("purchase_value", "Purchase value", 0), step: 0.01 },
            choice("condition", "Condition", [
              "GOOD",
              "FAIR",
              "POOR",
              "OUT_OF_SERVICE",
            ]),
            choice(
              "responsible_user_id",
              "Responsible person",
              opts(data?.users),
              false,
            ),
          ];
  return (
    <>
      <PageHead
        title="Facilities & assets"
        description="Maintain a reliable learning environment and track repair costs."
      />
      <Errors queries={[setup]} />
      <div className="tabs">
        {["maintenance", "facilities", "assets"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {human(t)}
          </button>
        ))}
      </div>
      {data &&
        (tab === "maintenance" ? (
          <Cases {...props} setup={data} kind="MAINTENANCE" />
        ) : (
          <Panel
            title={human(tab)}
            action={
              can("facilities.manage") && (
                <Button onClick={() => setModal({ type: tab })}>
                  Add {tab === "assets" ? "asset" : "facility"}
                </Button>
              )
            }
          >
            <Table
              rows={data[tab]}
              columns={[
                {
                  label: tab === "assets" ? "Asset" : "Facility",
                  render: (r) =>
                    tab === "assets"
                      ? `${r.asset_code} · ${r.description}`
                      : r.name,
                },
                {
                  label: "Location / category",
                  render: (r) =>
                    r.location ||
                    data.facilities.find((f) => f.id === r.facility_id)?.name,
                },
                {
                  label: "Condition",
                  render: (r) => <Badge value={r.condition} />,
                },
                ...(tab === "assets"
                  ? [
                      {
                        label: "Purchase value",
                        render: (r) => money(r.purchase_value_cents),
                      },
                    ]
                  : []),
                {
                  label: "",
                  render: (r) =>
                    can("facilities.manage") && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ type: "condition", table: tab, row: r })
                        }
                      >
                        Update condition
                      </button>
                    ),
                },
              ]}
              empty={{
                title: "No records yet",
                description:
                  "Add facilities before recording assets or maintenance.",
              }}
            />
          </Panel>
        ))}
      {modal && (
        <Editor
          title={
            modal.type === "condition"
              ? "Update condition"
              : `Add ${modal.type === "assets" ? "asset" : "facility"}`
          }
          fields={fields}
          initial={modal.row || {}}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </>
  );
}
export function People({ can, user, config, notify }) {
  const setup = useData("/operations/setup", null),
    q = useData("/hr/overview", null),
    [tab, setTab] = useState(() => {
      const requested = location.hash.slice(1).split("/")[1];
      const allowed = can("hr.manage")
        ? ["leave", "profiles", "vacancies", "applicants", "reviews", "calendar"]
        : ["leave"];
      return allowed.includes(requested)
        ? requested
        : "leave";
    }),
    [modal, setModal] = useState(null),
    [detail, setDetail] = useState(null),
    manage = can("hr.manage"),
    tabs = manage
      ? ["leave", "profiles", "vacancies", "applicants", "reviews", "calendar"]
      : ["leave"];
  const data = q.data,
    s = setup.data;
  async function save(v) {
    const type = modal.type;
    if (type === "profile") await patch(`/hr/staff/${modal.row.id}/profile`, v);
    if (type === "vacancy") await post("/hr/vacancies", v);
    if (type === "applicant") await post("/hr/applicants", v);
    if (type === "recruit")
      await post(`/hr/applicants/${modal.row.id}/stage`, {
        ...v,
        interview_at: v.interview_at
          ? new Date(v.interview_at).toISOString()
          : undefined,
        hire_date: v.hire_date || undefined,
      });
    if (type === "cancel") await post(`/hr/leave/${modal.row.id}/cancel`, v);
    if (type === "leave") await post("/hr/leave", v);
    if (type === "decision")
      await post(`/hr/leave/${modal.row.id}/decision`, v);
    if (type === "review") await post("/hr/reviews", v);
    setModal(null);
    q.reload();
    setup.reload();
    notify("HR record saved.");
  }
  const fields = {
    profile: [
      choice("supervisor_user_id", "Supervisor", opts(s?.users), false),
      memo("qualifications", "Qualifications", false),
      memo("certifications", "Certifications", false),
      memo("employment_history", "Employment history", false),
      memo("contract_notes", "Contract notes", false),
      memo("training", "Training / development", false),
    ],
    vacancy: [
      txt("title", "Job title"),
      txt("department", "Department"),
      memo("description", "Job description"),
      day("closing_date", "Closing date", config.today),
    ],
    applicant: [
      choice("vacancy_id", "Vacancy", opts(data?.vacancies, "title")),
      txt("first_name", "First name"),
      txt("last_name", "Last name"),
      { name: "email", label: "Email", type: "email" },
      txt("phone", "Phone"),
      memo("qualifications", "Qualifications"),
    ],
    recruit: [
      choice("stage", "Next recruitment stage", [
        "SHORTLISTED",
        "INTERVIEW",
        "OFFERED",
        "HIRED",
        "REJECTED",
      ]),
      {
        name: "interview_at",
        label: "Interview date and time (required for interview)",
        type: "datetime-local",
        required: false,
      },
      {
        ...day("hire_date", "Hire date (required when hiring)"),
        required: false,
      },
      memo("note", "Evaluation / decision note"),
    ],
    leave: [
      day("start_date", "Leave start", config.today),
      day("end_date", "Leave end", config.today),
      memo("reason", "Reason for leave"),
    ],
    cancel: [memo("reason", "Reason for cancellation")],
    decision: [
      choice("status", "Decision", [
        ...(modal?.row?.supervisor_user_id === user.id ? ["REVIEWED"] : []),
        ...(manage ? ["APPROVED", "REJECTED"] : []),
      ]),
      memo("note", "Decision note"),
    ],
    review: [
      choice("staff_id", "Staff member", opts(s?.staff, person)),
      choice("academic_year_id", "Academic year", opts(config.years)),
      nfield("development_score", "Professional development score (%)", 0, 100),
      memo("notes", "Review evidence and notes"),
    ],
  };
  return (
    <>
      <PageHead
        title="People & HR"
        description="Recruitment, leave decisions and evidence-based staff reviews."
      />
      <Errors queries={[setup, q]} />
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {human(t)}
          </button>
        ))}
      </div>
      {tab === "calendar" && manage && <WorkCalendar notify={notify} />}
      {data && s && tab !== "calendar" && (
        <Panel
          title={human(tab)}
          action={
            tab === "leave" ? (
              <Button onClick={() => setModal({ type: "leave" })}>
                Request leave
              </Button>
            ) : (
              tab !== "profiles" && (
                <Button
                  onClick={() =>
                    setModal({
                      type: {
                        vacancies: "vacancy",
                        applicants: "applicant",
                        reviews: "review",
                      }[tab],
                    })
                  }
                >
                  Add{" "}
                  {
                    {
                      vacancies: "vacancy",
                      applicants: "applicant",
                      reviews: "review",
                    }[tab]
                  }
                </Button>
              )
            )
          }
        >
          {tab === "leave" && (
            <>
              <p className="muted">
                Your supervisor reviews the request; HR then approves or rejects
                it. Approved leave counts configured working days, excludes
                holidays and checks the annual allowance. HR can cancel an
                approval; request amended dates as a new application.
              </p>
              <Table
                rows={data.leave}
                columns={[
                  { label: "Staff", render: person },
                  { label: "From", key: "start_date" },
                  { label: "To", key: "end_date" },
                  {
                    label: "Working days",
                    render: (r) => r.working_days ?? "Pending",
                  },
                  {
                    label: "",
                    render: (r) =>
                      !r.cancelled_at &&
                      r.status !== "REJECTED" &&
                      (manage ||
                        (r.user_id === user.id && r.status !== "APPROVED")) && (
                        <button
                          className="text-button"
                          onClick={() => setModal({ type: "cancel", row: r })}
                        >
                          Cancel leave
                        </button>
                      ),
                  },
                  {
                    label: "Status",
                    render: (r) => (
                      <Badge value={r.cancelled_at ? "CANCELLED" : r.status} />
                    ),
                  },
                  {
                    label: "Reason",
                    render: (r) => <span className="wrap">{r.reason}</span>,
                  },
                  {
                    label: "",
                    render: (r) =>
                      !r.cancelled_at &&
                      !["APPROVED", "REJECTED"].includes(r.status) &&
                      (manage || r.supervisor_user_id === user.id) && (
                        <button
                          className="text-button"
                          onClick={() => setModal({ type: "decision", row: r })}
                        >
                          Review leave
                        </button>
                      ),
                  },
                ]}
              />
            </>
          )}
          {tab === "profiles" && (
            <Table
              rows={s.staff}
              columns={[
                { label: "Staff", render: person },
                { label: "Department", key: "department" },
                {
                  label: "Documents",
                  render: (r) => (
                    <button
                      className="text-button"
                      onClick={() => setDetail({ documents: r })}
                    >
                      HR documents
                    </button>
                  ),
                },
                {
                  label: "Supervisor",
                  render: (r) =>
                    s.users.find((u) => u.id === r.supervisor_user_id)?.name ||
                    "Not assigned",
                },
                {
                  label: "",
                  render: (r) => (
                    <button
                      className="text-button"
                      onClick={() => setModal({ type: "profile", row: r })}
                    >
                      Edit HR profile
                    </button>
                  ),
                },
              ]}
            />
          )}
          {tab === "vacancies" && (
            <Table
              rows={data.vacancies}
              columns={[
                { label: "Position", key: "title" },
                { label: "Department", key: "department" },
                { label: "Closing", key: "closing_date" },
                { label: "Status", render: (r) => <Badge value={r.status} /> },
                {
                  label: "",
                  render: (r) => (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await patch(`/hr/vacancies/${r.id}`, {
                            status: r.status === "OPEN" ? "CLOSED" : "OPEN",
                          });
                          q.reload();
                        } catch (e) {
                          notify(e.message);
                        }
                      }}
                    >
                      {r.status === "OPEN" ? "Close vacancy" : "Reopen vacancy"}
                    </button>
                  ),
                },
              ]}
            />
          )}
          {tab === "applicants" && (
            <Table
              rows={data.applicants}
              columns={[
                { label: "Applicant", render: person },
                { label: "Position", key: "title" },
                { label: "Stage", render: (r) => <Badge value={r.stage} /> },
                {
                  label: "Interview",
                  render: (r) =>
                    r.interview_at
                      ? new Date(r.interview_at).toLocaleString()
                      : "—",
                },
                {
                  label: "",
                  render: (r) => (
                    <div className="row-actions">
                      {!["HIRED", "REJECTED"].includes(r.stage) && (
                        <button
                          className="text-button"
                          onClick={() => setModal({ type: "recruit", row: r })}
                        >
                          Progress applicant
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            setDetail({
                              title: person(r),
                              history: await get(
                                `/hr/applicants/${r.id}/history`,
                              ),
                            });
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        History
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          )}
          {tab === "reviews" && (
            <>
              <p className="muted">
                Attendance, punctuality and curriculum coverage are calculated
                from recorded data. Missing measures are excluded and remaining
                weights are renormalized.
              </p>
              <Table
                rows={data.reviews}
                columns={[
                  { label: "Staff", render: person },
                  { label: "Year", key: "year_name" },
                  { label: "Revision", key: "revision" },
                  {
                    label: "",
                    render: (r) => (
                      <button
                        className="text-button"
                        onClick={() => setDetail({ amend: r })}
                      >
                        Amend / history
                      </button>
                    ),
                  },
                  {
                    label: "Score",
                    render: (r) => r.overall_score ?? "Insufficient data",
                  },
                  {
                    label: "Missing measures",
                    render: (r) =>
                      r.snapshot.missing_metrics.join(", ") || "None",
                  },
                  {
                    label: "",
                    render: (r) => (
                      <button
                        className="text-button"
                        onClick={() =>
                          setDetail({
                            title: `Review · ${person(r)}`,
                            review: r,
                          })
                        }
                      >
                        View review
                      </button>
                    ),
                  },
                ]}
              />
            </>
          )}
        </Panel>
      )}
      {modal && (
        <Editor
          title={
            {
              profile: "Edit HR profile",
              vacancy: "Create vacancy",
              applicant: "Add applicant",
              recruit: "Progress applicant",
              leave: "Request leave",
              decision: "Review leave",
              cancel: "Cancel leave",
              review: "Record performance review",
            }[modal.type]
          }
          fields={fields[modal.type]}
          initial={modal.type === "profile" ? modal.row : {}}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {detail?.documents && (
        <StaffDocuments
          staff={detail.documents}
          onClose={() => setDetail(null)}
          notify={notify}
        />
      )}
      {detail?.amend && (
        <ReviewAmendment
          review={detail.amend}
          onClose={() => setDetail(null)}
          onChange={q.reload}
          notify={notify}
        />
      )}
      {detail && !detail.documents && !detail.amend && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          {detail.history ? (
            <Table
              rows={detail.history}
              columns={[
                { label: "Stage", render: (r) => human(r.stage) },
                {
                  label: "Note",
                  render: (r) => <span className="wrap">{r.note}</span>,
                },
                {
                  label: "Date",
                  render: (r) => new Date(r.created_at).toLocaleString(),
                },
              ]}
            />
          ) : (
            <>
              <p className="wrap">{detail.review.notes}</p>
              <Table
                rows={Object.entries(detail.review.snapshot.metrics).map(
                  ([name, value]) => ({
                    name,
                    value,
                    weight: detail.review.snapshot.weights[name],
                  }),
                )}
                columns={[
                  { label: "Measure", render: (r) => human(r.name) },
                  { label: "Score", render: (r) => r.value ?? "No data" },
                  { label: "Configured weight", render: (r) => `${r.weight}%` },
                ]}
              />
              <p>{detail.review.snapshot.rule}</p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function OperationsMetrics({ can, go }) {
  const q = useData(
    can("operations.summary") ? "/operations/summary" : null,
    null,
  );
  if (q.error) return <p className="form-error">{q.error}</p>;
  if (!q.data) return null;
  const d = q.data;
  return (
    <div className="metrics-grid">
      <Metric
        label="Parent satisfaction"
        value={
          d.satisfaction_score === null ? "—" : `${d.satisfaction_score}/5`
        }
        detail={`${d.survey_responses} responses`}
        icon={Heart}
        onClick={() => go("quality")}
      />
      <Metric
        label="Open complaints"
        value={d.open_complaints}
        detail={
          d.resolution_hours
            ? `${d.resolution_hours}h average resolution`
            : "No resolved complaints yet"
        }
        icon={ClipboardList}
        onClick={() => go("quality")}
      />
      <Metric
        label="Maintenance issues"
        value={d.maintenance_open}
        detail={`${d.urgent_repairs} urgent · ${d.facilities_good}/${d.facilities_total} facilities good`}
        icon={Wrench}
        onClick={
          can("operations.staff")
            ? () => go("facilities")
            : () => go("intelligence")
        }
      />
      <Metric
        label="Staff vacancies"
        value={d.staff_vacancies}
        detail={`${d.discipline_incidents} discipline incidents recorded`}
        icon={Users}
        onClick={
          can("hr.manage") ? () => go("people") : () => go("intelligence")
        }
      />
    </div>
  );
}
