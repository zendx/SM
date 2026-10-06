import React, { useState, useEffect } from "react";
import { Plus, ArrowRight, Upload, ExternalLink } from "lucide-react";
import { api, get, post, patch } from "../api";
import { useData } from "../hooks";
import {
  PageHead,
  Button,
  Panel,
  Table,
  Person,
  Badge,
  SearchBox,
  Modal,
  Form,
  human,
  Loading,
} from "../components";
const classOptions = (data) =>
  data.map((c) => ({ value: c.id, label: c.name }));
export const applicationFields = (classes) => [
  { name: "first_name", label: "First name" },
  { name: "last_name", label: "Last name" },
  { name: "middle_name", label: "Middle name", required: false },
  { name: "gender", label: "Gender", options: ["FEMALE", "MALE", "OTHER"] },
  { name: "date_of_birth", label: "Date of birth", type: "date" },
  { name: "nationality", label: "Nationality", required: false },
  {
    name: "applied_class_id",
    label: "Applying for class",
    options: classOptions(classes),
  },
  {
    name: "boarding_status",
    label: "Boarding status",
    options: ["DAY", "BOARDING"],
    default: "DAY",
  },
  { name: "guardian_name", label: "Parent / guardian name" },
  {
    name: "relationship",
    label: "Relationship",
    options: ["FATHER", "MOTHER", "GUARDIAN"],
    default: "GUARDIAN",
  },
  { name: "guardian_phone", label: "Guardian phone", type: "tel" },
  {
    name: "guardian_email",
    label: "Guardian email",
    type: "email",
    required: false,
  },
  {
    name: "address",
    label: "Residential address",
    wide: true,
    required: false,
  },
  { name: "previous_school", label: "Previous school", required: false },
  {
    name: "transportation_required",
    label: "School transportation required",
    type: "checkbox",
  },
  {
    name: "medical_info",
    label: "Medical information",
    type: "textarea",
    required: false,
  },
  {
    name: "special_requirements",
    label: "Special requirements",
    type: "textarea",
    required: false,
  },
];
export function Admissions({ term, notify, go }) {
  const q = useData("/admissions/applications"),
    classes = useData("/classes");
  const [modal, setModal] = useState(null),
    [filter, setFilter] = useState("");
  const stages = [
    "SUBMITTED",
    "REVIEWED",
    "ASSESSMENT_SCHEDULED",
    "DECISION_PENDING",
    "OFFERED",
    "FEES_PENDING",
    "ENROLLED",
  ];
  async function save(fn) {
    await fn();
    q.reload();
    setModal(null);
    notify("Application updated.");
  }
  return (
    <>
      <PageHead
        title="Admissions"
        description="A clear path from first application to the first day of school."
      >
        <Button onClick={() => setModal({ type: "new" })}>
          <Plus size={17} />
          New application
        </Button>
      </PageHead>
      <div className="mini-stats">
        {[
          [
            "Active applications",
            q.data.filter((a) => !["REJECTED", "ENROLLED"].includes(a.stage))
              .length,
          ],
          ["Offers issued", q.data.filter((a) => a.stage === "OFFERED").length],
          [
            "Awaiting fees",
            q.data.filter((a) => a.stage === "FEES_PENDING").length,
          ],
          ["Enrolled", q.data.filter((a) => a.stage === "ENROLLED").length],
        ].map(([name, n]) => (
          <div key={name}>
            <span>{name}</span>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <Panel
        title="Application pipeline"
        action={
          <select
            aria-label="Filter admission stage"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All stages</option>
            {[...stages, "REJECTED"].map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
        }
      >
        {q.error && <p className="form-error">{q.error}</p>}
        <Table
          rows={q.data.filter((a) => !filter || a.stage === filter)}
          columns={[
            {
              label: "Applicant",
              render: (r) => (
                <Person
                  first={r.first_name}
                  last={r.last_name}
                  sub={`APP-${String(r.id).padStart(4, "0")}`}
                />
              ),
            },
            { label: "Class", key: "class_name" },
            { label: "Guardian", key: "guardian_name" },
            { label: "Stage", render: (r) => <Badge value={r.stage} /> },
            {
              label: "Next step",
              render: (r) =>
                !["ENROLLED", "REJECTED"].includes(r.stage) && (
                  <div className="row-actions">
                    <Button
                      small
                      secondary
                      onClick={() => setModal({ type: "stage", row: r })}
                    >
                      {r.stage === "FEES_PENDING"
                        ? "Enroll"
                        : human(stages[stages.indexOf(r.stage) + 1])}
                      <ArrowRight size={14} />
                    </Button>
                    <button
                      className="text-button muted"
                      onClick={() => setModal({ type: "reject", row: r })}
                    >
                      Reject
                    </button>
                  </div>
                ),
            },
          ]}
          empty={{
            title: "Your next school story starts here",
            description:
              "Create an application to begin the admission workflow.",
          }}
        />
      </Panel>
      {modal && (
        <Modal
          title={
            modal.type === "new"
              ? "New student application"
              : modal.type === "reject"
                ? "Reject application"
                : modal.row.stage === "FEES_PENDING"
                  ? "Complete enrollment"
                  : "Advance application"
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "new" ? (
            <>
              {!classes.data.length && (
                <div className="notice">
                  Create a class in Administration before submitting an
                  application.
                </div>
              )}
              <Form
                fields={applicationFields(classes.data)}
                onSubmit={(v) =>
                  save(() => post("/admissions/applications", v))
                }
                submit="Create application"
              />
            </>
          ) : modal.type === "reject" ? (
            <Form
              fields={[
                {
                  name: "notes",
                  label: "Reason for rejection",
                  type: "textarea",
                  wide: true,
                },
              ]}
              onSubmit={(v) =>
                save(() =>
                  patch(`/admissions/applications/${modal.row.id}/stage`, {
                    stage: "REJECTED",
                    ...v,
                  }),
                )
              }
              submit="Reject application"
            />
          ) : modal.row.stage === "FEES_PENDING" ? (
            <Form
              fields={[]}
              onSubmit={() =>
                save(() =>
                  post(`/admissions/applications/${modal.row.id}/enroll`, {
                    term_id: term,
                  }),
                )
              }
              submit="Enroll student"
            >
              <p>
                A paid or waived invoice for the selected term and an available
                class place are required.
              </p>
            </Form>
          ) : (
            <Form
              fields={[
                {
                  name: "notes",
                  label: "Decision / review notes",
                  type: "textarea",
                  wide: true,
                  required: false,
                },
              ]}
              onSubmit={(v) =>
                save(() =>
                  patch(`/admissions/applications/${modal.row.id}/stage`, {
                    stage: stages[stages.indexOf(modal.row.stage) + 1],
                    ...v,
                  }),
                )
              }
              submit={`Move to ${human(stages[stages.indexOf(modal.row.stage) + 1])}`}
            />
          )}
        </Modal>
      )}
    </>
  );
}
export function Students({ can, user, notify, go }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [result, setResult] = useState({ data: [], meta: { total: 0 } }),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [edit, setEdit] = useState(false),
    [version, setVersion] = useState(0);
  const classes = useData(
    can("classes.write") || can("students.write") ? "/classes" : null,
  );
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(
      () =>
        api(
          `/students?search=${encodeURIComponent(search)}&status=${status}&page=${page}`,
        )
          .then((r) => {
            if (active) {
              setResult(r);
              setError("");
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      150,
    );
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [search, status, page, version]);
  async function view(id) {
    try {
      setSelected(await get(`/students/${id}`));
      setEdit(false);
    } catch (e) {
      notify(e.message);
    }
  }
  async function save(v) {
    await patch(`/students/${selected.id}`, v);
    await view(selected.id);
    setVersion((v) => v + 1);
    notify("Student profile updated.");
  }
  const editFields =
    user.role === "PARENT"
      ? [
          {
            name: "address",
            label: "Residential address",
            wide: true,
            required: false,
          },
          { name: "guardian_phone", label: "Guardian phone", wide: true },
        ]
      : [
          { name: "first_name", label: "First name" },
          { name: "last_name", label: "Last name" },
          { name: "guardian_name", label: "Guardian name" },
          { name: "guardian_phone", label: "Guardian phone" },
          {
            name: "guardian_email",
            label: "Guardian email",
            type: "email",
            required: false,
          },
          { name: "address", label: "Residential address", required: false },
          {
            name: "medical_info",
            label: "Medical information",
            type: "textarea",
            required: false,
          },
          {
            name: "special_requirements",
            label: "Special requirements",
            type: "textarea",
            required: false,
          },
          {
            name: "parent_user_id",
            label: "Linked parent account ID",
            type: "number",
            required: false,
            hint: "Find the parent user ID in Administration.",
          },
        ];
  return (
    <>
      <PageHead
        title={user.role === "PARENT" ? "My children" : "Students"}
        description="Every student’s story, connected in one place."
      >
        {can("admissions.write") && (
          <Button onClick={() => go("admissions")}>
            <Plus size={17} />
            New application
          </Button>
        )}
      </PageHead>
      <Panel>
        <div className="table-toolbar">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search name or student ID…"
          />
          <select
            aria-label="Student status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              "ENROLLED",
              "PROSPECTIVE",
              "WITHDRAWN",
              "GRADUATED",
              "SUSPENDED",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="results-count">{result.meta.total} students</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <Table
          rows={result.data}
          columns={[
            {
              label: "Student",
              render: (r) => (
                <Person
                  first={r.first_name}
                  last={r.last_name}
                  sub={r.student_number || "Prospective student"}
                  onClick={() => view(r.id)}
                />
              ),
            },
            { label: "Class", render: (r) => r.class_name || "Not assigned" },
            {
              label: "Guardian",
              render: (r) => (
                <div>
                  {r.guardian_name}
                  <small className="block muted">{r.guardian_phone}</small>
                </div>
              ),
            },
            { label: "Boarding", render: (r) => human(r.boarding_status) },
            { label: "Status", render: (r) => <Badge value={r.status} /> },
            {
              label: "Profile",
              render: (r) => (
                <button className="text-button" onClick={() => view(r.id)}>
                  View profile →
                </button>
              ),
            },
          ]}
          empty={{
            title: "A place for every student",
            description:
              "Student records appear here after an application is created.",
          }}
        />
        <div className="pagination">
          <span>
            Page {page} of {Math.max(1, Math.ceil(result.meta.total / 25))}
          </span>
          <Button
            secondary
            small
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            secondary
            small
            disabled={page * 25 >= result.meta.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </Panel>
      {selected && (
        <Modal title="Student profile" onClose={() => setSelected(null)}>
          <div className="profile-hero">
            <Person
              first={selected.first_name}
              last={selected.last_name}
              sub={selected.student_number || "Application in progress"}
            />
            <Badge value={selected.status} />
          </div>
          {edit ? (
            <Form
              initial={selected}
              fields={editFields}
              onSubmit={(v) =>
                save({
                  ...v,
                  ...("parent_user_id" in v
                    ? {
                        parent_user_id: v.parent_user_id
                          ? Number(v.parent_user_id)
                          : null,
                      }
                    : {}),
                })
              }
            />
          ) : (
            <>
              <div className="profile-details">
                {[
                  ["Date of birth", selected.date_of_birth],
                  ["Gender", human(selected.gender)],
                  ["Guardian", selected.guardian_name],
                  ["Phone", selected.guardian_phone],
                  ["Address", selected.address],
                  ["Medical information", selected.medical_info],
                  ["Special requirements", selected.special_requirements],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{v}</strong>
                    </div>
                  ))}
              </div>
              {(can("students.write") || can("children.write")) && (
                <Button secondary onClick={() => setEdit(true)}>
                  Edit profile
                </Button>
              )}
              {can("students.write") && selected.status === "ENROLLED" && (
                <details className="details-box">
                  <summary>Transfer to another class</summary>
                  <Form
                    fields={[
                      {
                        name: "class_id",
                        label: "New class",
                        options: classOptions(classes.data),
                      },
                    ]}
                    onSubmit={async (v) => {
                      await post(`/students/${selected.id}/enrollment`, v);
                      await view(selected.id);
                      setVersion((v) => v + 1);
                      notify("Class transfer complete.");
                    }}
                    submit="Transfer student"
                  />
                </details>
              )}
              {can("students.write") &&
                ["ENROLLED", "SUSPENDED"].includes(selected.status) && (
                  <details className="details-box">
                    <summary>Update enrollment status</summary>
                    <Form
                      fields={[
                        {
                          name: "status",
                          label: "New status",
                          options:
                            selected.status === "SUSPENDED"
                              ? ["ENROLLED", "WITHDRAWN", "GRADUATED"]
                              : ["SUSPENDED", "WITHDRAWN", "GRADUATED"],
                        },
                        {
                          name: "reason",
                          label: "Reason",
                          type: "textarea",
                          wide: true,
                        },
                      ]}
                      onSubmit={async (v) => {
                        await patch(`/students/${selected.id}/status`, v);
                        await view(selected.id);
                        setVersion((v) => v + 1);
                        notify("Enrollment status updated.");
                      }}
                      submit="Update status"
                    />
                  </details>
                )}
              <h3 className="section-title">Recent attendance</h3>
              <Table
                rows={selected.attendance}
                keyField="attendance_date"
                columns={[
                  { label: "Date", key: "attendance_date" },
                  {
                    label: "Status",
                    render: (r) => <Badge value={r.status} />,
                  },
                  { label: "Remarks", key: "remarks" },
                ]}
                empty={{ title: "No attendance recorded yet" }}
              />
              <h3 className="section-title">Supporting documents</h3>
              {selected.documents.map((d) => (
                <a
                  className="document-link"
                  href={`/api/v1/documents/${d.id}`}
                  key={d.id}
                >
                  {d.name}
                  <ExternalLink size={15} />
                </a>
              ))}
              {(can("students.write") || can("children.write")) && (
                <label className="upload-box">
                  <Upload size={20} />
                  <span>Upload PDF, PNG or JPEG · up to 4 MB</span>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    aria-label="Upload supporting document"
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const data = new FormData();
                      data.append("document", file);
                      try {
                        await post(`/students/${selected.id}/documents`, data);
                        await view(selected.id);
                        notify("Document uploaded.");
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  />
                </label>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
