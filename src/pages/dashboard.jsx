import { PlatformInbox } from "./platform-notifications";
import React, { useEffect } from "react";
import {
  Users,
  CalendarCheck,
  Wallet,
  ArrowUpRight,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  UserCheck,
  GraduationCap,
  Plus,
} from "lucide-react";
import { useData } from "../hooks";
import { patch } from "../api";
import { OperationsMetrics } from "./operations";
import { openAlert } from "./alerts";
import {
  PageHead,
  Button,
  Panel,
  Metric,
  Trend,
  Empty,
  Loading,
  Badge,
  Table,
} from "../components";
export function Dashboard({ user, config, term, can, money, go, notify }) {
  const academics = useData(
    can("analytics.read") || can("analytics.summary")
      ? `/academics/overview?term_id=${term}`
      : null,
    null,
  );
  const query = useData(`/dashboard/executive?term_id=${term}`, null),
    alerts = useData("/alerts");
  useEffect(() => {
    const timer = setInterval(query.reload, 60_000);
    return () => clearInterval(timer);
  }, [term]);
  if (query.error) return <div className="form-error">{query.error}</div>;
  if (!query.data) return <Loading />;
  const d = query.data,
    rate = d.attendance.recorded
      ? Math.round((d.attendance.present / d.attendance.recorded) * 100)
      : null,
    collection =
      d.finance && Number(d.finance.billed)
        ? Math.round(
            (Number(d.finance.collected) / Number(d.finance.billed)) * 100,
          )
        : 0;
  const newTools = [
    (can("academics.manage") ||
      can("academics.read") ||
      can("analytics.summary")) && {
      label: can("academics.manage")
        ? "Academic records"
        : can("analytics.summary") && !can("academics.read")
          ? "Academic analytics"
          : "Academics",
      page: "academics",
      section: can("academics.manage")
        ? "records"
        : can("analytics.summary") && !can("academics.read")
          ? "analytics"
          : undefined,
    },
    (can("curriculum.read") || can("curriculum.summary")) && {
      label: "Curriculum tracking",
      page: "curriculum",
    },
    (can("operations.staff") ||
      can("experience.own") ||
      can("operations.summary")) && {
      label: "School experience",
      page: "quality",
    },
    can("operations.staff") && {
      label: "Facilities & assets",
      page: "facilities",
    },
    can("hr.manage") && {
      label: "Staff documents",
      page: "people",
      section: "profiles",
    },
    can("hr.manage") && {
      label: "HR calendar",
      page: "people",
      section: "calendar",
    },
    can("hr.manage") && {
      label: "Review amendments",
      page: "people",
      section: "reviews",
    },
    can("operations.staff") &&
      !can("hr.manage") && {
        label: "My leave",
        page: "people",
        section: "leave",
      },
    can("intelligence.read") && {
      label: can("intelligence.manage")
        ? "Historical model evaluation"
        : "Intelligence",
      page: "intelligence",
      section: can("intelligence.manage") ? "models" : undefined,
    },
  ].filter(Boolean);
  return (
    <>
      <PageHead
        eyebrow="YOUR SCHOOL, AT A GLANCE"
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description={new Date(`${config.today}T12:00:00`).toLocaleDateString(
          "en-GB",
          { weekday: "long", day: "numeric", month: "long", year: "numeric" },
        )}
      >
        {can("admissions.write") && (
          <Button onClick={() => go("admissions")}>
            <Plus size={17} />
            New application
          </Button>
        )}
      </PageHead>
      <div className="overview-banner">
        <div className="banner-icon">
          <GraduationCap size={30} />
        </div>
        <div>
          <span>SCHOOL OVERVIEW</span>
          <h2>A little clarity. A better school day.</h2>
          <p>
            Keep track of the people and priorities that move your school
            forward.
          </p>
        </div>
        <div className="live-label">
          <span /> Live school records
        </div>
      </div>
      {newTools.length > 0 && (
        <Panel
          title="Quick access"
          description="Frequently used tools for your role."
        >
          <div className="toolbar dashboard-shortcuts">
            {newTools.map((tool) => (
              <Button
                key={tool.label}
                secondary
                onClick={() => go(tool.page, tool.section)}
              >
                {tool.label}
              </Button>
            ))}
          </div>
        </Panel>
      )}
      <div className="metrics-grid">
        <Metric
          label="Enrolled students"
          value={d.enrollment.enrolled.toLocaleString()}
          detail={`${d.enrollment.prospective} prospective students`}
          icon={Users}
          onClick={can("students.read") ? () => go("students") : null}
        />
        <Metric
          label="Attendance today"
          value={rate === null ? "—" : `${rate}%`}
          detail={
            d.attendance.recorded
              ? `${d.attendance.present} present / ${d.attendance.recorded} recorded`
              : "Awaiting today’s attendance"
          }
          icon={CalendarCheck}
          onClick={can("attendance.read") ? () => go("attendance") : null}
        />
        {d.finance && (
          <>
            <Metric
              label="Fees collected"
              value={money(d.finance.collected)}
              detail={`${collection}% of term billing collected`}
              icon={Wallet}
              tone="accent"
              onClick={can("finance.read") ? () => go("finance") : null}
            />
            <Metric
              label="Outstanding fees"
              value={money(d.finance.outstanding)}
              detail={`${d.finance.overdue} overdue invoices`}
              icon={ArrowUpRight}
              onClick={can("finance.read") ? () => go("finance") : null}
            />
          </>
        )}
      </div>
      <OperationsMetrics can={can} go={go} />
      {academics.data && (
        <div className="metrics-grid">
          <Metric
            label="Academic average"
            value={
              academics.data.average === null
                ? "—"
                : `${academics.data.average}%`
            }
            detail="Completed subject results · selected term"
            icon={GraduationCap}
            onClick={() => go("academics")}
          />
          <Metric
            label="Curriculum coverage"
            value={
              academics.data.curriculum_percent === null
                ? "—"
                : `${academics.data.curriculum_percent}%`
            }
            detail="Completed topics · selected term"
            icon={CheckCircle2}
            onClick={() => go("curriculum")}
          />
          <Metric
            label="Students at risk"
            value={academics.data.at_risk}
            detail="Open flags from finalized results"
            icon={AlertCircle}
            onClick={() => go("academics")}
          />
          <Metric
            label="Topics behind schedule"
            value={academics.data.behind_topics}
            detail="Beyond the school's delay tolerance"
            icon={CalendarCheck}
            onClick={() => go("curriculum")}
          />
        </div>
      )}
      {academics.error && (
        <p className="form-error">Academic overview: {academics.error}</p>
      )}
      <div className="dashboard-grid">
        <Panel
          title="Attendance over time"
          description="Present and late students · selected term"
          action={
            <span className="chart-legend">
              <i />
              Attendance %
            </span>
          }
        >
          <Trend data={d.attendanceTrend} />
        </Panel>
        <Panel
          title="Management attention"
          description="Current issues that may need a closer look"
          className="attention-panel"
        >
          {alerts.data.length ? (
            <div className="alerts-list">
              {alerts.data.slice(0, 5).map((a) => (
                <div className="alert-row" key={a.id}>
                  <span
                    className={`alert-icon ${a.severity === "HIGH" ? "red" : ""}`}
                  >
                    <AlertCircle size={18} />
                  </span>
                  <div>
                    <small>{a.category}</small>
                    <button
                      className="alert-link"
                      onClick={() => openAlert(a, go)}
                    >
                      {a.message}
                    </button>
                    {a.status === "ACKNOWLEDGED" ? (
                      <Badge value={a.status} />
                    ) : (
                      <button
                        className="text-button muted"
                        onClick={async () => {
                          try {
                            await patch(`/alerts/${a.id}/acknowledge`, {});
                            alerts.reload();
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : d.alertSummary.length ? (
            <div className="summary-alerts">
              {d.alertSummary.map((a) => (
                <p key={a.category}>
                  <AlertCircle size={18} />
                  {a.count} {a.category.toLowerCase()} alert(s)
                </p>
              ))}
            </div>
          ) : (
            <Empty
              title="You’re all caught up"
              description="Attendance and overdue fee alerts will appear here."
            />
          )}
        </Panel>
        <Panel
          title="Enrollment by class"
          description="Current enrolled students and available capacity"
        >
          {d.classCounts.length ? (
            <div className="class-bars">
              {d.classCounts.map((c) => (
                <div className="class-bar" key={c.name}>
                  <div>
                    <strong>{c.name}</strong>
                    <span>
                      {c.count} / {c.capacity} students
                    </span>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{ width: `${(c.count / c.capacity) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Make room for your first class"
              description="Create classes in Administration to start your school roster."
            />
          )}
        </Panel>
        {d.finance ? (
          <Panel
            title="Fee collection activity"
            description="Payments received · selected term"
          >
            <Trend data={d.collectionTrend} currency money={money} />
          </Panel>
        ) : (
          <Panel title="School operations" description="A snapshot of today">
            <div className="quick-stats">
              <div>
                <strong>{d.staff.total}</strong>
                <span>Active staff</span>
              </div>
              <div>
                <strong>{d.staff.present}</strong>
                <span>Staff present</span>
              </div>
            </div>
          </Panel>
        )}
      </div>
      <div className="bottom-stats">
        <div>
          <UserCheck size={22} />
          <span>
            <strong>
              {d.staff.present} / {d.staff.total}
            </strong>
            <small>Staff present today</small>
          </span>
        </div>
        <div>
          <CalendarCheck size={22} />
          <span>
            <strong>{d.staff.late}</strong>
            <small>Staff late today</small>
          </span>
        </div>
        <div>
          <Users size={22} />
          <span>
            <strong>{d.enrollment.prospective}</strong>
            <small>Prospective students</small>
          </span>
        </div>
        <div>
          <CheckCircle2 size={22} />
          <span>
            <strong>{d.classCounts.length}</strong>
            <small>Classes this academic year</small>
          </span>
        </div>
      </div>
    </>
  );
}
export function Notifications() {
  const q = useData("/notifications");
  return (
    <>
      <PlatformInbox />
      <PageHead
        title="Notifications"
        description="School updates and delivery status."
      />
      <Panel>
        {q.error ? (
          <p className="form-error">{q.error}</p>
        ) : (
          <Table
            rows={q.data}
            columns={[
              {
                label: "Message",
                render: (r) => (
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.body}</p>
                  </div>
                ),
              },
              {
                label: "Delivery",
                render: (r) => <Badge value={r.delivery_status} />,
              },
              {
                label: "Created",
                render: (r) => new Date(r.created_at).toLocaleString(),
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
