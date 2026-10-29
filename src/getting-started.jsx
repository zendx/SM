import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  School,
  CalendarDays,
  Users,
  LayoutGrid,
  Wallet,
  Receipt,
  GraduationCap,
  ShieldCheck,
} from "lucide-react";
import { Button, Panel } from "./components";
import { useData } from "./hooks";
import "./getting-started.css";

const guidance = {
  school: {
    label: "School profile",
    icon: School,
    action: "Set school preferences",
    intro: "Make this workspace your school's own.",
    fields: [
      "School name and contact details",
      "Currency for fees and payments",
      "Timezone for school activities",
    ],
  },
  calendar: {
    label: "Academic calendar",
    icon: CalendarDays,
    action: "Set academic calendar",
    intro: "Give your school year a clear starting point.",
    fields: [
      "Academic year and term dates",
      "The term your school is currently in",
      "A current term for enrollment and fees",
    ],
  },
  staff: {
    label: "Your team",
    icon: Users,
    action: "Add staff",
    intro: "Bring the people behind your school together.",
    fields: [
      "Your first staff member's details",
      "Their role and contact information",
      "A teacher account, where needed",
    ],
  },
  classes: {
    label: "Classes",
    icon: LayoutGrid,
    action: "Create a class",
    intro: "Create a place for your first group of learners.",
    fields: [
      "A class name your team recognises",
      "The correct academic year",
      "A teacher assignment, when available",
    ],
  },
  integrations: {
    label: "Payment methods",
    icon: Wallet,
    action: "Set up payments",
    intro: "Make it easy for families to pay school fees.",
    fields: [
      "Your preferred payment method",
      "Bank or payment provider details",
      "Payment instructions for families",
    ],
  },
  "fee structures": {
    label: "School fees",
    icon: Receipt,
    action: "Set fee structure",
    intro: "Give families a clear picture of their school fees.",
    fields: [
      "The class and current academic term",
      "Fee items and their amounts",
      "A saved fee structure for the term",
    ],
  },
  admissions: {
    label: "First student",
    icon: GraduationCap,
    action: "Open admissions",
    intro: "Welcome your first learner to the school.",
    fields: [
      "Student and parent information",
      "An application for the right class",
      "Completed next steps and confirmed enrollment",
    ],
  },
};

export function GettingStarted({ data, config, can, go }) {
  const [selected, setSelected] = useState(null);
  const admin = can("admin.write");
  const paymentMethods = useData(
    admin && can("finance.read") ? "/payments/school/methods" : null,
    {},
  );
  const fees = useData(can("finance.read") ? "/finance/fee-structures" : null);
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
      title: "Add your staff",
      detail:
        "Create staff records and teacher accounts so your team can begin.",
      done: data.staff.total > 0,
      page: "staff",
      allowed: can("staff.write"),
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
      title: "Set up payment methods",
      detail: "Configure how your school will receive fee payments.",
      done: Object.keys(paymentMethods.data).length > 0,
      page: "administration",
      section: "integrations",
      allowed: admin,
    },
    {
      title: "Set your school fees",
      detail: "Set class fees for the current academic term.",
      done: fees.data.some((fee) =>
        config.terms.some((term) => term.is_current && term.id === fee.term_id),
      ),
      page: "finance",
      section: "fee structures",
      allowed: can("finance.write"),
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
  const active = visible.find((step) => step.title === selected) || next;
  const index = visible.indexOf(active);
  const info = guidance[active.section || active.page];
  const Icon = info.icon;
  const percent = Math.round((complete / visible.length) * 100);
  return (
    <section className="school-setup" aria-labelledby="school-setup-title">
      <header className="school-setup-header">
        <div>
          <span className="school-setup-eyebrow">LET’S GET YOU STARTED</span>
          <h2 id="school-setup-title">Get your school ready</h2>
          <p>A few simple steps to set your school up for a great start.</p>
        </div>
        <div className="school-setup-progress">
          <div>
            <span>
              {complete} of {visible.length} complete
            </span>
            <strong>{percent}%</strong>
          </div>
          <progress
            aria-label="School setup completion"
            value={complete}
            max={visible.length}
          />
        </div>
      </header>
      <div className="school-setup-body">
        <nav className="school-setup-nav" aria-label="School setup steps">
          <ol>
            {visible.map((step, i) => (
              <li key={step.title}>
                <button
                  type="button"
                  className={`school-setup-step ${step === active ? "is-active" : ""} ${step.done ? "is-done" : ""}`}
                  aria-current={step === active ? "step" : undefined}
                  onClick={() => setSelected(step.title)}
                >
                  <span className="school-setup-number" aria-hidden="true">
                    {step.done ? (
                      <Check size={15} strokeWidth={3} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  <span className="school-setup-step-copy">
                    <strong>{guidance[step.section || step.page].label}</strong>
                    <small>
                      {step.done
                        ? "Completed"
                        : step === next
                          ? "Next to complete"
                          : "To do"}
                    </small>
                  </span>
                  {step === active && (
                    <ArrowRight size={16} aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ol>
          <p className="school-setup-note">
            <ShieldCheck size={16} aria-hidden="true" />
            Your progress is saved as you go.
          </p>
        </nav>
        <div className="school-setup-content">
          <div
            className="school-setup-detail"
            key={active.title}
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="school-setup-detail-top">
              <span className="school-setup-icon">
                <Icon size={27} aria-hidden="true" />
              </span>
              <span
                className={`school-setup-status ${active.done ? "is-done" : ""}`}
              >
                {active.done ? (
                  <>
                    <CheckCircle2 size={14} /> Completed
                  </>
                ) : (
                  `Step ${index + 1} of ${visible.length}`
                )}
              </span>
            </div>
            <h3>{active.title}</h3>
            <p className="school-setup-intro">
              {info.intro} {active.detail}
            </p>
            <div className="school-setup-checklist">
              <h4>
                {active.done ? "What you can review" : "What you’ll set up"}
              </h4>
              <ul>
                {info.fields.map((field) => (
                  <li key={field}>
                    <CheckCircle2 size={17} aria-hidden="true" />
                    {field}
                  </li>
                ))}
              </ul>
            </div>
            <div className="school-setup-action">
              <Button onClick={() => go(active.page, active.section)}>
                {active.done ? "Review details" : info.action}
                <ArrowRight size={17} aria-hidden="true" />
              </Button>
              <p>
                {active.done
                  ? "Your saved records have completed this step."
                  : "Save your details, then return here to continue."}
              </p>
            </div>
          </div>
          <footer className="school-setup-footer">
            <Button
              secondary
              disabled={index === 0}
              onClick={() => setSelected(visible[index - 1].title)}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back
            </Button>
            <span>
              {index + 1} / {visible.length}
            </span>
            <Button
              secondary
              disabled={index === visible.length - 1}
              onClick={() => setSelected(visible[index + 1].title)}
            >
              Next step
              <ArrowRight size={15} aria-hidden="true" />
            </Button>
          </footer>
        </div>
      </div>
    </section>
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
      padded
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
