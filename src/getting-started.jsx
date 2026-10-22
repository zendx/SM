import React from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { Button, Panel } from "./components";

export function GettingStarted({ data, config, can, go }) {
  const admin = can("admin.write");
  const steps = [
    {
      title: "Set school preferences",
      detail: "Set your school name, currency and timezone.",
      done: Boolean(
        config.school.name &&
        config.school.currency_code &&
        config.school.timezone,
      ),
      page: "administration",
      section: "school",
      allowed: admin,
    },
    {
      title: "Set the academic calendar",
      detail: "Choose the current term before enrolling students.",
      done: config.terms.some((t) => t.is_current),
      page: "administration",
      section: "calendar",
      allowed: admin,
    },
    {
      title: "Create a class",
      detail: "Students need a class in the selected term's academic year.",
      done: data.classCounts.length > 0,
      page: "administration",
      section: "classes",
      allowed: admin,
    },
    {
      title: "Add your staff",
      detail:
        "Create staff records and teacher accounts so your team can begin.",
      done: data.staff.total > 0,
      page: "staff",
      allowed: can("staff.write"),
    },
    {
      title: "Enroll your first student",
      detail:
        "Create an application, follow its next steps, then confirm enrollment.",
      done: data.enrollment.enrolled > 0,
      page: "admissions",
      allowed: can("admissions.write"),
    },
  ];
  const visible = steps.filter((s) => s.allowed);
  const next = visible.find((s) => !s.done);
  if (!visible.length) return <DailyWork can={can} go={go} />;
  if (!next) return <DailyWork can={can} go={go} ready />;
  const complete = visible.filter((s) => s.done).length;
  return (
    <Panel
      title="Get your school ready"
      description="Your progress comes from saved school records. Return here any time to continue."
    >
      <div className="setup-next">
        <div>
          <strong>Next: {next.title}</strong>
          <p>{next.detail}</p>
        </div>
        <Button onClick={() => go(next.page, next.section)}>
          Continue setup
        </Button>
      </div>
      <label className="setup-progress">
        {complete} of {visible.length} steps complete
        <progress value={complete} max={visible.length} />
      </label>
      <ol className="setup-steps">
        {visible.map((step) => (
          <li key={step.title}>
            <span aria-label={step.done ? "Complete" : "Incomplete"}>
              {step.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
            <Button secondary onClick={() => go(step.page, step.section)}>
              {step.done ? "Review" : "Open"}
            </Button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function DailyWork({ can, go, ready = false, parent = false }) {
  const actions = parent
    ? [
        ["View my children's results", "academics", "reports.academic.own"],
        ["Check school fees", "finance", "finance.own"],
      ]
    : [
        ["Record attendance", "attendance", "attendance.write"],
        ["Review applications", "admissions", "admissions.write"],
        ["Review outstanding fees", "finance", "finance.read"],
        ["Open gradebook", "academics", "academics.read", "gradebook"],
        ["View learners", "students", "students.read"],
      ];
  const available = actions.filter((a) => can(a[2]));
  if (!available.length) return null;
  return (
    <Panel
      title={
        parent
          ? "Your next steps"
          : ready
            ? "Your school is ready. Start today's work."
            : "Start today's work"
      }
      description={
        parent
          ? "Open a child's profile below for their details, or check results and fees here."
          : "Choose a task for your school day."
      }
    >
      <div className="toolbar">
        {available.map(([label, page, , section], i) => (
          <Button
            key={label}
            secondary={i > 0}
            onClick={() => go(page, section)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Panel>
  );
}
