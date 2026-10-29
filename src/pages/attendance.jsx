import { CreateSchoolAccount } from "./account-assignments";
import { AccountRemoval } from "./account-removal";
import React, { useEffect, useState } from "react";
import { Plus, CheckCheck, Save, LogIn, LogOut } from "lucide-react";
import { get, post } from "../api";
import { useData } from "../hooks";
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
  Empty,
} from "../components";
const statuses = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
  "SICK",
  "AUTHORIZED_ABSENCE",
];
export function Attendance({ config, can, notify, term, go }) {
  const classes = useData("/classes");
  const [cls, setCls] = useState(""),
    [day, setDay] = useState(config.today),
    [records, setRecords] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!cls && classes.data.length) setCls(String(classes.data[0].id));
  }, [classes.data]);
  useEffect(() => {
    if (!cls) return;
    let active = true;
    setBusy(true);
    get(`/attendance/students?class_id=${cls}&date=${day}`)
      .then((data) => {
        if (active) {
          setRecords(
            data.map((r) => ({ ...r, status: r.status || "PRESENT" })),
          );
          setDirty(false);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [cls, day]);
  async function save() {
    setBusy(true);
    try {
      await post("/attendance/students", {
        class_id: cls,
        date: day,
        records: records.map((r) => ({
          student_id: r.id,
          status: r.status,
          remarks: r.remarks || "",
        })),
      });
      setDirty(false);
      notify(`Attendance saved for ${records.length} students.`);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        title="Student attendance"
        description="Choose a class and date, mark each student, then save the register."
      >
        {can("attendance.write") && (
          <Button disabled={!records.length || busy} onClick={save}>
            <Save size={17} />
            Save attendance
          </Button>
        )}
      </PageHead>
      <Panel>
        <div className="table-toolbar">
          <label className="inline-field">
            Class
            <select
              value={cls}
              onChange={(e) => setCls(e.target.value)}
              aria-label="Attendance class"
            >
              <option value="">Select class</option>
              {classes.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            Date
            <input
              type="date"
              value={day}
              max={config.today}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          {can("attendance.write") && (
            <Button
              secondary
              small
              onClick={() => {
                setRecords(records.map((r) => ({ ...r, status: "PRESENT" })));
                setDirty(true);
              }}
            >
              <CheckCheck size={16} />
              All present
            </Button>
          )}
          {can("admin.write") && (
            <Button
              small
              secondary
              onClick={async () => {
                try {
                  await post("/attendance/unlock", {
                    class_id: cls,
                    date: day,
                  });
                  notify("Attendance unlocked for this class and date.");
                } catch (e) {
                  setError(e.message);
                }
              }}
              disabled={!cls}
            >
              Unlock date
            </Button>
          )}
        </div>
        <div className="attendance-summary">
          {["PRESENT", "ABSENT", "LATE"].map((s) => (
            <span key={s}>
              <i className={s.toLowerCase()} />
              <strong>
                {records.filter((r) => r.status === s).length}
              </strong>{" "}
              {human(s)}
            </span>
          ))}
          <small>
            {dirty
              ? "Unsaved changes"
              : "New registers default to Present. Review before saving."}
          </small>
        </div>
        {(error || classes.error) && (
          <p className="form-error">{error || classes.error}</p>
        )}
        <Table
          rows={records}
          columns={[
            {
              label: "Student",
              render: (r) => (
                <Person
                  first={r.first_name}
                  last={r.last_name}
                  sub={r.student_number}
                />
              ),
            },
            {
              label: "Status",
              render: (r) => (
                <select
                  aria-label={`Attendance for ${r.first_name} ${r.last_name}`}
                  disabled={!can("attendance.write") || busy}
                  value={r.status}
                  onChange={(e) => {
                    setRecords(
                      records.map((x) =>
                        x.id === r.id ? { ...x, status: e.target.value } : x,
                      ),
                    );
                    setDirty(true);
                  }}
                >
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {human(s)}
                    </option>
                  ))}
                </select>
              ),
            },
            {
              label: "Remarks",
              render: (r) => (
                <input
                  aria-label={`Remarks for ${r.first_name}`}
                  placeholder="Optional note"
                  value={r.remarks || ""}
                  disabled={!can("attendance.write") || busy}
                  onChange={(e) => {
                    setRecords(
                      records.map((x) =>
                        x.id === r.id ? { ...x, remarks: e.target.value } : x,
                      ),
                    );
                    setDirty(true);
                  }}
                />
              ),
            },
          ]}
          empty={{
            title: "No enrolled students in this class",
            description:
              "Complete an admission and class assignment to begin recording attendance.",
            children: can("admissions.write") ? (
              <Button onClick={() => go("admissions")}>Enroll a student</Button>
            ) : null,
          }}
        />
      </Panel>
    </>
  );
}
export function Staff({ can, notify, config, user }) {
  const staff = useData("/hr/staff"),
    attendance = useData("/attendance/staff"),
    [tab, setTab] = useState("directory"),
    [modal, setModal] = useState(null),
    [removeAccount, setRemoveAccount] = useState(null);
  async function action(path, body) {
    await post(path, body);
    staff.reload();
    attendance.reload();
    setModal(null);
    notify("Staff record updated.");
  }
  return (
    <>
      <PageHead
        title="Staff & attendance"
        description="Record staff arrival and departure times, and review attendance."
      >
        {can("admin.write") && (
          <Button
            onClick={() => {
              setModal({ type: "new" });
            }}
          >
            <Plus size={17} />
            Add staff member
          </Button>
        )}
      </PageHead>
      <div className="tabs">
        <button
          className={tab === "directory" ? "active" : ""}
          onClick={() => setTab("directory")}
        >
          Staff directory
        </button>
        <button
          className={tab === "attendance" ? "active" : ""}
          onClick={() => setTab("attendance")}
        >
          Attendance log
        </button>
      </div>
      <Panel>
        {(staff.error || attendance.error) && (
          <p className="form-error">{staff.error || attendance.error}</p>
        )}
        {tab === "directory" ? (
          <Table
            rows={staff.data}
            empty={{
              title: "Add your first staff member",
              description:
                "Create staff records so you can track attendance and build your school team.",
              children: can("admin.write") ? (
                <Button
                  onClick={() => {
                    setModal({ type: "new" });
                  }}
                >
                  Add staff member
                </Button>
              ) : null,
            }}
            columns={[
              {
                label: "Staff member",
                render: (r) => (
                  <Person
                    first={r.first_name}
                    last={r.last_name}
                    sub={r.staff_number}
                  />
                ),
              },
              { label: "Department", key: "department" },
              { label: "Position", key: "position" },
              {
                label: "Employment",
                render: (r) => <Badge value={r.employment_type} />,
              },
              {
                label: "Today",
                render: (r) => (
                  <div className="row-actions">
                    {(can("staff.attendance.write") || r.user_id) && (
                      <>
                        <Button
                          small
                          secondary
                          onClick={async () => {
                            try {
                              await action("/attendance/staff/check-in", {
                                staff_id: r.id,
                              });
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          <LogIn size={14} />
                          In
                        </Button>
                        <Button
                          small
                          secondary
                          onClick={async () => {
                            try {
                              await action("/attendance/staff/check-out", {
                                staff_id: r.id,
                              });
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          <LogOut size={14} />
                          Out
                        </Button>
                      </>
                    )}
                    {can("staff.attendance.write") && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ type: "status", staff_id: r.id })
                        }
                      >
                        Status
                      </button>
                    )}
                  </div>
                ),
              },
              ...(can("admin.write")
                ? [
                    {
                      label: "Manage",
                      render: (r) =>
                        r.user_id &&
                        r.user_id !== user?.id && (
                          <button
                            className="text-button account-remove-link"
                            onClick={() =>
                              setRemoveAccount({
                                id: r.user_id,
                                name: `${r.first_name} ${r.last_name}`,
                                email: r.email,
                              })
                            }
                          >
                            Delete profile
                          </button>
                        ),
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <Table
            rows={attendance.data}
            columns={[
              { label: "Date", key: "attendance_date" },
              {
                label: "Staff member",
                render: (r) => `${r.first_name} ${r.last_name}`,
              },
              { label: "Status", render: (r) => <Badge value={r.status} /> },
              {
                label: "Check in",
                render: (r) =>
                  r.check_in_time
                    ? new Date(r.check_in_time).toLocaleTimeString("en-GB", {
                        timeZone: config.school.timezone,
                      })
                    : "—",
              },
              {
                label: "Check out",
                render: (r) =>
                  r.check_out_time
                    ? new Date(r.check_out_time).toLocaleTimeString("en-GB", {
                        timeZone: config.school.timezone,
                      })
                    : "—",
              },
              { label: "Hours worked", key: "hours" },
            ]}
          />
        )}
      </Panel>
      {removeAccount && (
        <AccountRemoval
          account={removeAccount}
          onClose={() => setRemoveAccount(null)}
          onRemoved={(message) => {
            setRemoveAccount(null);
            staff.reload();
            attendance.reload();
            notify(message);
          }}
        />
      )}
      {modal?.type === "new" && (
        <Modal title="Create school account" onClose={() => setModal(null)}>
          <CreateSchoolAccount
            onSubmit={async (values) => {
              const result = await post("/users", values);
              staff.reload();
              attendance.reload();
              setModal(null);
              notify(result.message || "Account created.");
            }}
          />
        </Modal>
      )}
      {modal?.type === "status" && (
        <Modal
          title="Record staff attendance status"
          onClose={() => setModal(null)}
        >
          <Form
            fields={[
              {
                name: "date",
                label: "Date",
                type: "date",
                default: config.today,
              },
              {
                name: "status",
                label: "Attendance status",
                options: [
                  "ABSENT",
                  "LEAVE",
                  "SICK_LEAVE",
                  "OFFICIAL_ASSIGNMENT",
                ],
              },
            ]}
            onSubmit={(values) =>
              action("/attendance/staff/status", {
                ...values,
                staff_id: modal.staff_id,
              })
            }
          />
        </Modal>
      )}
    </>
  );
}
