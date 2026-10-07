import {
  NotificationBell,
  PlatformInbox,
} from "./pages/platform-notifications";
import { SchoolSupport } from "./pages/owner-support";
import { CookieNotice, LegalPage, LegalFooter } from "./pages/legal";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  GraduationCap,
  CalendarCheck,
  Wallet,
  Users,
  FileBarChart,
  Settings,
  LogOut,
  Bell,
  Menu,
  ChevronDown,
  ArrowUpRight,
  ShieldCheck,
  School,
  BookOpen,
  ChevronRight,
  LifeBuoy,
} from "lucide-react";
import { api, get, post, setCsrf, tenantSlug } from "./api";
import { Landing, Signup, PublicBrand } from "./pages/saas-public";
import { Subscription, SaasOwner } from "./pages/saas-billing";
import { OwnerPortal } from "./pages/owner";
import { Form, Button, Loading, human } from "./components";
import {
  Dashboard,
  TeacherWorkspace,
  Students,
  Admissions,
  Attendance,
  Finance,
  Staff,
  Reports,
  Administration,
  Notifications,
  Academics,
  Curriculum,
  Intelligence,
  Platform,
  ManagementAlerts,
} from "./pages";
import "./styles.css";
import { applicationFields } from "./pages/students";
import { useData } from "./hooks";
import { Quality, People, Facilities } from "./pages/operations";

function PublicApplication({ code }) {
  const q = useData(
      `/auth/public-admissions/${encodeURIComponent(code)}`,
      null,
    ),
    [result, setResult] = useState(null);
  return (
    <div className="public-application">
      <div className="brand">
        <span className="brand-mark">
          <GraduationCap />
        </span>
        SMPIS
      </div>
      <h1>{q.data?.school.name || "School admissions"}</h1>
      <p>Start your child’s next chapter. Complete the application below.</p>
      {q.error ? (
        <div className="form-error">{q.error}</div>
      ) : result ? (
        <div className="notice">
          <h2>Application received</h2>
          <p>
            Your reference: <strong>{result.reference}</strong>
          </p>
          {result.message}
        </div>
      ) : q.data ? (
        <>
          <div className="notice">
            Information is used to review this application. Supporting documents
            are collected securely by the admissions office.
          </div>
          <Form
            fields={applicationFields(q.data.classes)}
            onSubmit={async (v) =>
              setResult(
                await post(
                  `/auth/public-admissions/${encodeURIComponent(code)}`,
                  v,
                ),
              )
            }
            submit="Submit application"
          />
        </>
      ) : (
        <Loading />
      )}
      <a className="text-button auth-link" href="/">
        Staff / parent sign in
      </a>
    </div>
  );
}

function Auth({ onLogin, setup }) {
  const reset = new URLSearchParams(location.search).get("reset");
  const verification = new URLSearchParams(location.search).get("verify");
  const [mode, setMode] = useState(
      setup ? "setup" : verification ? "verify" : reset ? "reset" : "login",
    ),
    [message, setMessage] = useState(
      verification ? "Confirm your email to activate your account." : "",
    );
  const year = new Date().getFullYear();
  const setupFields = [
    { name: "school_name", label: "School name", wide: true },
    {
      name: "phone_number",
      label: "Administrator phone number",
      type: "tel",
      wide: true,
    },
    {
      name: "short_code",
      label: "School code",
      placeholder: "SMP",
      maxLength: 12,
    },
    { name: "currency_code", label: "Currency", default: "NGN", maxLength: 3 },
    {
      name: "timezone",
      label: "Timezone",
      default: "Africa/Lagos",
      wide: true,
    },
    { name: "name", label: "Your full name", wide: true },
    { name: "email", label: "Administrator email", type: "email", wide: true },
    {
      name: "password",
      label: "Administrator password",
      type: "password",
      minLength: 12,
      hint: "At least 12 characters",
      wide: true,
    },
    {
      name: "year_name",
      label: "Academic year",
      default: `${year}/${year + 1}`,
      wide: true,
    },
    {
      name: "start_date",
      label: "Year starts",
      type: "date",
      default: `${year}-09-01`,
    },
    {
      name: "end_date",
      label: "Year ends",
      type: "date",
      default: `${year + 1}-07-31`,
    },
  ];
  async function submit(v) {
    if (mode === "verify") {
      setMessage(
        (
          await post("/auth/email-verification/confirm", {
            token: verification,
          })
        ).message,
      );
      history.replaceState(null, "", location.pathname);
      setMode("login");
    } else if (mode === "resend") {
      setMessage(
        (await post("/auth/email-verification/resend", { email: v.email }))
          .message,
      );
    } else if (mode === "setup") {
      const result = await post("/auth/setup", v);
      setMessage(result.message);
      setMode("login");
    } else if (mode === "forgot") {
      setMessage((await post("/auth/password-reset/request", v)).message);
    } else if (mode === "reset") {
      await post("/auth/password-reset/confirm", { ...v, token: reset });
      history.replaceState({}, "", location.pathname);
      setMessage("Password updated. Sign in to continue.");
      setMode("login");
    } else {
      const result = await post("/auth/login", v);
      setCsrf(result.csrf);
      onLogin(
        tenantSlug && result.user.platform_operator ? await get("/me") : result,
      );
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap />
          </div>
          <div>
            SMPIS<small>SCHOOL INTELLIGENCE</small>
          </div>
        </div>
        <div>
          <div className="eyebrow">A CLEARER VIEW OF YOUR SCHOOL</div>
          <h1>
            Every school day.
            <br />
            Better connected.
          </h1>
          <p>
            Bring your people, operations and performance together in one
            thoughtful workspace.
          </p>
          <div className="story-grid">
            <span>
              <Users />
              Student records
            </span>
            <span>
              <CalendarCheck />
              Daily attendance
            </span>
            <span>
              <Wallet />
              Fee collection
            </span>
            <span>
              <FileBarChart />
              Management insights
            </span>
          </div>
        </div>
        <small>School Management, Performance & Intelligence System</small>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="eyebrow">
            {mode === "setup" ? "LET’S GET STARTED" : "WELCOME TO SMPIS"}
          </div>
          <h1>
            {mode === "setup"
              ? "Set up your school"
              : mode === "verify"
                ? "Verify your email"
                : mode === "resend"
                  ? "Resend verification email"
                  : mode === "forgot"
                    ? "Reset your password"
                    : mode === "reset"
                      ? "Choose a new password"
                      : "Welcome back"}
          </h1>
          <p>
            {mode === "setup"
              ? "Create your school workspace and its first administrator."
              : mode === "verify"
                ? "Confirm your email address to activate your account."
                : mode === "resend"
                  ? "Enter your registration email to receive a new link."
                  : "Your school, in focus. Sign in to your workspace."}
          </p>
          {message && <div className="notice">{message}</div>}
          <Form
            key={mode}
            fields={
              mode === "verify"
                ? []
                : mode === "setup"
                  ? setupFields
                  : ["forgot", "resend"].includes(mode)
                    ? [
                        {
                          name: "email",
                          label: "Email address",
                          type: "email",
                          wide: true,
                        },
                      ]
                    : mode === "reset"
                      ? [
                          {
                            name: "password",
                            label: "New password",
                            type: "password",
                            wide: true,
                            minLength: 12,
                          },
                        ]
                      : [
                          {
                            name: "email",
                            label: "Email address",
                            type: "email",
                            wide: true,
                            autoComplete: "username",
                          },
                          {
                            name: "password",
                            label: "Password",
                            type: "password",
                            wide: true,
                            autoComplete: "current-password",
                          },
                        ]
            }
            onSubmit={submit}
            submit={
              mode === "verify"
                ? "Verify email"
                : mode === "resend"
                  ? "Resend verification email"
                  : mode === "setup"
                    ? "Create school workspace"
                    : mode === "forgot"
                      ? "Send reset link"
                      : mode === "reset"
                        ? "Update password"
                        : "Sign in to your workspace"
            }
          />
          {mode === "login" && (
            <button
              className="text-button auth-link"
              onClick={() => setMode("resend")}
            >
              Resend verification email
            </button>
          )}
          {mode === "login" && (
            <button
              className="text-button auth-link"
              onClick={() => setMode("forgot")}
            >
              Forgot your password?
            </button>
          )}
          {["forgot", "resend", "verify"].includes(mode) && (
            <button
              className="text-button auth-link"
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
            >
              Back to sign in
            </button>
          )}
          <div className="auth-note">
            <ShieldCheck size={16} /> Secure access for your school community
          </div>
        </div>
      </main>
    </div>
  );
}
function App() {
  const [session, setSession] = useState(null),
    [subscription, setSubscription] = useState(null),
    [portal, setPortal] = useState(null),
    [setup, setSetup] = useState(false),
    [loading, setLoading] = useState(true),
    [config, setConfig] = useState(null),
    [page, setPage] = useState(
      location.hash.slice(1).split("/")[0] || "dashboard",
    ),
    [initialRoute, setInitialRoute] = useState(true),
    [term, setTerm] = useState(""),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(""),
    [fatal, setFatal] = useState(""),
    [fatalCode, setFatalCode] = useState("");
  const can = (p) =>
    session?.user.permissions.includes("*") ||
    session?.user.permissions.includes(p);
  const nav = [
    [
      "teaching",
      "Teacher workspace",
      BookOpen,
      session?.user.role === "TEACHER",
    ],
    [
      "dashboard",
      "Overview",
      LayoutDashboard,
      can("dashboard.read") || can("finance.summary"),
    ],
    [
      "students",
      session?.user.role === "PARENT"
        ? "My children"
        : session?.user.role === "TEACHER"
          ? "My learners"
          : "Students",
      GraduationCap,
      can("students.read") || can("children.read"),
    ],
    ["admissions", "Admissions", BookOpen, can("admissions.write")],
    ["attendance", "Attendance", CalendarCheck, can("attendance.read")],
    ["finance", "Finance", Wallet, can("finance.read") || can("finance.own")],
    [
      "academics",
      can("reports.academic.own") && !can("academics.read")
        ? "Academic results"
        : "Academics",
      GraduationCap,
      can("academics.read") ||
        can("analytics.summary") ||
        can("reports.academic.own"),
    ],
    [
      "curriculum",
      "Curriculum",
      BookOpen,
      can("curriculum.read") || can("curriculum.summary"),
    ],
    [
      "staff",
      "Staff & attendance",
      Users,
      can("staff.read") || can("staff.attendance.read") || can("staff.self"),
    ],
    [
      "reports",
      "Reports",
      FileBarChart,
      [
        "reports.students",
        "reports.attendance",
        "reports.finance",
        "reports.staff",
        "discipline.manage",
        "complaints.manage",
        "facilities.manage",
        "hr.manage",
      ].some(can),
    ],
    ["administration", "Administration", Settings, true],
    [
      "quality",
      "School experience",
      ShieldCheck,
      can("operations.staff") ||
        can("experience.own") ||
        can("operations.summary"),
    ],
    ["people", "People & HR", Users, can("operations.staff")],
    ["facilities", "Facilities & assets", School, can("operations.staff")],
    ["intelligence", "Intelligence", ArrowUpRight, can("intelligence.read")],
    ["subscription", "Subscription", Wallet, true],
    ["support", "Support", LifeBuoy, session?.user.role === "SUPER_ADMIN"],
    ["platform", "SaaS business", School, !!session?.user.platform_operator],
    [
      "alerts",
      "Alerts",
      Bell,
      (can("attendance.read") && session?.user.role !== "TEACHER") ||
        can("finance.read") ||
        can("discipline.manage") ||
        can("complaints.manage") ||
        can("facilities.manage") ||
        can("academics.manage") ||
        can("curriculum.manage"),
    ],
  ].filter(
    (n) =>
      n[3] && (!session?.user.mfa_setup_required || n[0] === "administration"),
  );
  function notify(msg) {
    setToast(msg);
  }
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function reloadConfig() {
    const c = await get("/config");
    setConfig(c);
    setTerm(
      (t) =>
        t ||
        String(c.terms.find((x) => x.is_current)?.id || c.terms[0]?.id || ""),
    );
  }
  async function reloadSubscription() {
    const sub = await get("/subscription");
    setSubscription(sub);
  }
  useEffect(() => {
    (async () => {
      try {
        if (tenantSlug)
          setPortal(
            await get(`/saas/portal/${encodeURIComponent(tenantSlug)}`),
          );
        const s = await get("/auth/setup");
        setSetup(s.required);
        if (!s.required) {
          try {
            const me = await get("/me");
            if (
              !tenantSlug &&
              me.user.console_access &&
              me.user.school_id === null
            ) {
              location.replace("/owner");
              return;
            }
            if (
              !tenantSlug &&
              !me.user.platform_operator &&
              me.user.portal_slug
            ) {
              location.replace(
                `/${me.user.portal_slug}/${location.search}${location.hash || "#dashboard"}`,
              );
              return;
            }
            setCsrf(me.csrf);
            setSession(me);
          } catch (e) {
            if (e.status !== 401) throw e;
          }
        }
      } catch (e) {
        setFatal(e.message);
        setFatalCode(e.code || "");
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (session && !session.mfa_required) {
      reloadConfig().catch((e) => setFatal(e.message));
      reloadSubscription().catch((e) => setFatal(e.message));
    }
  }, [session]);
  useEffect(() => {
    const expired = () =>
      reloadSubscription().catch((e) => setFatal(e.message));
    window.addEventListener("smpis-subscription-inactive", expired);
    return () =>
      window.removeEventListener("smpis-subscription-inactive", expired);
  }, []);
  useEffect(() => {
    if (
      initialRoute &&
      session &&
      !session.mfa_required &&
      session.user.role === "TEACHER" &&
      ["dashboard", "students"].includes(page)
    ) {
      location.hash = "teaching";
      setPage("teaching");
      setInitialRoute(false);
      return;
    }
    if (initialRoute && session && !session.mfa_required)
      setInitialRoute(false);
    if (
      session &&
      !session.mfa_required &&
      !session.user.mfa_setup_required &&
      new URLSearchParams(location.search).has("payment_reference") &&
      (can("finance.read") || can("finance.own"))
    )
      go("finance");
  }, [session]);
  useEffect(() => {
    if (
      session &&
      !session.mfa_required &&
      !session.user.mfa_setup_required &&
      new URLSearchParams(location.search).has("payment_reference") &&
      (can("finance.read") || can("finance.own"))
    )
      go("finance");
  }, [session]);
  useEffect(() => {
    const fn = () =>
      setPage(location.hash.slice(1).split("/")[0] || "dashboard");
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    if (
      session &&
      !session.mfa_required &&
      !nav.some((n) => n[0] === page) &&
      (page !== "notifications" || session.user.mfa_setup_required)
    )
      go(nav[0]?.[0] || "administration");
  }, [session, page]);
  function go(p, section) {
    location.hash = section ? `${p}/${section}` : p;
    setPage(p);
    setInitialRoute(false);
    setMobile(false);
  }
  const money = (v) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: config?.school.currency_code || "NGN",
      maximumFractionDigits: 2,
    }).format(Number(v || 0) / 100);
  if (loading) return <Loading />;
  if (fatal)
    return (
      <div className="fatal">
        <h1>We couldn’t load SMPIS</h1>
        <p>{fatal}</p>
        {fatalCode === "TENANT_MISMATCH" && (
          <Button
            onClick={async () => {
              try {
                const me = (
                  await api("/me", { headers: { "x-smpis-portal": "" } })
                ).data;
                setCsrf(me.csrf);
                await api("/auth/logout", {
                  method: "POST",
                  body: {},
                  headers: { "x-smpis-portal": "" },
                });
                location.reload();
              } catch (e) {
                setFatal(e.message);
              }
            }}
          >
            Switch account
          </Button>
        )}
        <Button onClick={() => location.reload()}>Try again</Button>
      </div>
    );
  if (!session)
    return (
      <>
        {portal && (
          <div className="portal-heading">
            {portal.name} · /{portal.portal_slug}/
          </div>
        )}
        <Auth
          setup={setup && location.pathname.replace(/\/$/, "") === "/owner"}
          onLogin={(s) => {
            if (
              !tenantSlug &&
              s.user.console_access &&
              s.user.school_id === null
            ) {
              location.assign("/owner");
              return;
            }
            if (
              !tenantSlug &&
              !s.user.platform_operator &&
              s.user.portal_slug
            ) {
              location.assign(
                `/${s.user.portal_slug}/${location.search}${location.hash || "#dashboard"}`,
              );
              return;
            }
            setSetup(false);
            setInitialRoute(true);
            setSession(s);
          }}
        />
      </>
    );
  if (session.mfa_required)
    return (
      <div className="mfa-card">
        <ShieldCheck size={36} />
        <h1>Two-step verification</h1>
        <p>Enter your authenticator code or a saved recovery code.</p>
        <Form
          fields={[
            {
              name: "code",
              label: "Verification code",
              wide: true,
              maxLength: 24,
            },
          ]}
          onSubmit={async (v) => {
            await post("/auth/mfa/verify", v);
            setSession({ ...session, mfa_required: false });
          }}
          submit="Verify and continue"
        />
        <Button
          secondary
          onClick={async () => {
            await post("/auth/logout", {});
            setSession(null);
            setPage("dashboard");
            location.hash = "dashboard";
            setInitialRoute(true);
          }}
        >
          Sign out
        </Button>
      </div>
    );
  if (!config) return <Loading />;
  if (!subscription) return <Loading />;
  if (
    !subscription.access_allowed &&
    !session.user.platform_operator &&
    !session.user.mfa_setup_required
  )
    return (
      <div className="billing-blocked">
        <div className="billing-blocked-header">
          <PublicBrand />
          <Button
            secondary
            onClick={async () => {
              await post("/auth/logout", {});
              setSession(null);
              setConfig(null);
              setSubscription(null);
              setCsrf("");
            }}
          >
            Sign out
          </Button>
        </div>
        {session.user.role === "SUPER_ADMIN" && (
          <div className="toolbar">
            <Button secondary onClick={() => go("subscription")}>
              Subscription
            </Button>
            <Button secondary onClick={() => go("support")}>
              Support
            </Button>
          </div>
        )}
        <NotificationBell onClick={() => go("notifications")} />
        {page === "notifications" ? (
          <PlatformInbox />
        ) : page === "support" && session.user.role === "SUPER_ADMIN" ? (
          <SchoolSupport />
        ) : (
          <Subscription
            user={session.user}
            blocked
            reloadSubscription={reloadSubscription}
          />
        )}
      </div>
    );
  // Wait for the route redirect before mounting a page that this account cannot use.
  if (
    !nav.some((n) => n[0] === page) &&
    (page !== "notifications" || session.user.mfa_setup_required)
  )
    return <Loading />;
  const context = {
    user: session.user,
    config,
    term,
    can,
    money,
    notify,
    go,
    reloadConfig,
    reloadSubscription,
    reloadSession: async () => {
      const me = await get("/me");
      setCsrf(me.csrf);
      setSession(me);
    },
  };
  const Current =
    {
      dashboard: Dashboard,
      teaching: TeacherWorkspace,
      students: Students,
      admissions: Admissions,
      attendance: Attendance,
      finance: Finance,
      staff: Staff,
      reports: Reports,
      administration: Administration,
      notifications: Notifications,
      academics: Academics,
      curriculum: Curriculum,
      quality: Quality,
      people: People,
      facilities: Facilities,
      intelligence: Intelligence,
      platform: SaasOwner,
      subscription: Subscription,
      support: SchoolSupport,
      alerts: ManagementAlerts,
    }[page] || Dashboard;
  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#dashboard">
          <span className="brand-mark">
            <GraduationCap size={26} />
          </span>
          <span>
            SMPIS<small>SCHOOL INTELLIGENCE</small>
          </span>
        </a>
        <div className="school-chip">
          <div className="school-icon">
            <School size={18} />
          </div>
          <div>
            <strong>{config.school.name}</strong>
            <small>School workspace</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => go(key)}
            >
              <Icon size={19} />
              {label}
              {page === key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="core-label">
            <span /> Core operations & academics
          </div>
          <p>Clarity for every school day.</p>
          <button
            className="signout"
            onClick={async () => {
              try {
                await post("/auth/logout", {});
                setSession(null);
                setConfig(null);
                setCsrf("");
                setPage("dashboard");
                location.hash = "dashboard";
                setInitialRoute(true);
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {nav.find((n) => n[0] === page)?.[1] || "Notifications"}
            </strong>
          </div>
          <div className="topbar-actions">
            <select
              aria-label="Academic term"
              className="term-select"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            >
              {config.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {config.years.find((y) => y.id === t.academic_year_id)?.name}{" "}
                  · {t.name}
                </option>
              ))}
            </select>
            <NotificationBell onClick={() => go("notifications")} />
            <div className="user-menu">
              <span className="avatar">
                {session.user.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{session.user.name}</strong>
                <small>{human(session.user.role)}</small>
              </div>
            </div>
          </div>
        </header>
        <main className="main-content">
          <Current key={page} {...context} />
        </main>
        <footer className="app-footer">
          <span>SMPIS · School management, thoughtfully connected.</span>
          <span>{config.school.timezone}</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
const applyCode = new URLSearchParams(location.search).get("apply");
createRoot(document.getElementById("root")).render(
  <>
    <CookieNotice />
    {["/terms", "/privacy", "/cookies"].includes(
      location.pathname.replace(/\/$/, ""),
    ) ? (
      <LegalPage type={location.pathname.replace(/\/$/, "").slice(1)} />
    ) : new URLSearchParams(location.search).has("verify") ? (
      <Auth
        setup={false}
        onLogin={(session) =>
          location.assign(
            session.user.console_access
              ? "/owner"
              : `/${session.user.portal_slug}/`,
          )
        }
      />
    ) : location.pathname.replace(/\/$/, "") === "/owner" ? (
      <OwnerPortal />
    ) : applyCode ? (
      <PublicApplication code={applyCode} />
    ) : location.pathname.replace(/\/$/, "") === "/signup" ? (
      <Signup />
    ) : location.pathname === "/" &&
      (!location.hash ||
        ["#features", "#how-it-works", "#pricing", "#faq"].includes(
          location.hash,
        )) &&
      !new URLSearchParams(location.search).has("reset") ? (
      <Landing />
    ) : (
      <App />
    )}
    <LegalFooter />
  </>,
);
