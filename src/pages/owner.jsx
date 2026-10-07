import {
  OwnerCommunications,
  PlatformInbox,
  NotificationBell,
} from "./platform-notifications";
import { PlatformTeam, ManagedSchools } from "./platform-team";
import { OwnerIssues } from "./owner-support";
import { EmailTemplates } from "./email-templates";
import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ChartNoAxesCombined,
  LayoutDashboard,
  Users,
  Wallet,
  Settings,
  ShieldCheck,
  Building2,
  LifeBuoy,
  LogOut,
  Menu,
  ArrowUpRight,
} from "lucide-react";
import { get, post, patch, setCsrf } from "../api";
import { Form, Button, Loading, Panel } from "../components";
import { SaasOwner } from "./saas-billing";
import "../saas.css";

const scopesLabel = (scope) =>
  ({
    SALES: "Sales support",
    TECHNICAL: "Technical support",
    SUBSCRIPTIONS: "Schools and subscriptions",
  })[scope] || "Console team";
function OwnerBrand() {
  return (
    <a href="/owner" className="brand">
      <span className="brand-mark">
        <ChartNoAxesCombined />
      </span>
      <span>
        SMPIS<small>BUSINESS CONSOLE</small>
      </span>
    </a>
  );
}
function OwnerSecurity({ session, reload }) {
  const [setup, setSetup] = useState(null),
    [codes, setCodes] = useState(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  return (
    <Panel
      title="Owner account security"
      description="Protect access to customer accounts, subscriptions and payment settings."
    >
      <div className="owner-security">
        <p>
          <strong>{session.user.name}</strong> · {session.user.email}
        </p>
        {error && <p className="form-error">{error}</p>}
        {!session.user.mfa_setup_required && (
          <>
            <h3>Edit owner credentials</h3>
            <Form
              key={session.user.email}
              initial={{ name: session.user.name, email: session.user.email }}
              fields={[
                { name: "name", label: "Your full name", wide: true },
                {
                  name: "email",
                  label: "Owner email address",
                  type: "email",
                  wide: true,
                },
                {
                  name: "current_password",
                  label: "Current password",
                  type: "password",
                  wide: true,
                  autoComplete: "current-password",
                },
                {
                  name: "new_password",
                  label: "New password",
                  type: "password",
                  wide: true,
                  required: false,
                  minLength: 12,
                  autoComplete: "new-password",
                  hint: "Leave blank to keep your password. New passwords need at least 12 characters.",
                },
              ]}
              submit="Save owner credentials"
              onSubmit={async (values) => {
                const { new_password, ...details } = values;
                const result = await patch("/saas/owner/profile", {
                  ...details,
                  ...(new_password ? { new_password } : {}),
                });
                await reload();
                setSaved(result.message);
              }}
            />
            {saved && (
              <p className="notice" role="status">
                {saved}
              </p>
            )}
            <hr />
          </>
        )}
        {session.user.mfa_enabled ? (
          <>
            <p className="notice">Two-step verification is enabled.</p>
            {codes ? (
              <div className="notice">
                <p>
                  Save these recovery codes somewhere private. Each code can be
                  used once.
                </p>
                <pre>{codes.join("\n")}</pre>
              </div>
            ) : (
              <Form
                fields={[
                  {
                    name: "password",
                    label: "Confirm your password",
                    type: "password",
                    wide: true,
                  },
                ]}
                submit="Generate recovery codes"
                onSubmit={async (v) =>
                  setCodes((await post("/auth/mfa/recovery-codes", v)).codes)
                }
              />
            )}
          </>
        ) : (
          <>
            {session.user.mfa_setup_required && (
              <p className="notice">
                Enable two-step verification to open your business dashboard.
              </p>
            )}
            {!setup ? (
              <Button
                onClick={async () => {
                  try {
                    setSetup(await post("/auth/mfa/setup", {}));
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Set up authenticator
              </Button>
            ) : (
              <>
                <QRCodeSVG
                  value={setup.uri}
                  size={190}
                  includeMargin
                  title="Owner authenticator setup"
                />
                <p>Scan with your authenticator, or enter this setup key:</p>
                <code className="secret-key">{setup.secret}</code>
                <Form
                  fields={[
                    {
                      name: "code",
                      label: "Verification code",
                      wide: true,
                      maxLength: 6,
                    },
                  ]}
                  submit="Enable verification"
                  onSubmit={async (v) => {
                    await post("/auth/mfa/enable", v);
                    setSetup(null);
                    await reload();
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
export function OwnerPortal() {
  const [session, setSession] = useState(null),
    [setupRequired, setSetupRequired] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [section, setSection] = useState(() =>
      location.hash.slice(1) === "platform"
        ? "overview"
        : location.hash.slice(1) || "overview",
    ),
    [mobile, setMobile] = useState(false),
    [tenantRevision, setTenantRevision] = useState(0);
  const sections = [
    ["overview", "Business overview", LayoutDashboard],
    ["tenants", "Schools & subscriptions", Building2],
    ["users", "Customer accounts", Users],
    ["payments", "Payments & revenue", Wallet],
    ["issues", "Customer support", LifeBuoy],
    ["settings", "Payment settings", Settings],
    ["audit", "Audit history", ShieldCheck],
    ["team", "Console team", Users],
    ["communications", "Tenant communications", Users],
    ["email-templates", "Email templates", Settings],
    ["inbox", "Notifications", LifeBuoy],
    ["security", "Account security", ShieldCheck],
  ].filter(
    ([key]) =>
      !session ||
      session.user.platform_operator ||
      key === "security" ||
      key === "inbox" ||
      (key === "issues" &&
        ["SALES", "TECHNICAL"].includes(session.user.platform_scope)) ||
      (key === "tenants" && session.user.platform_scope === "SUBSCRIPTIONS"),
  );
  async function reload() {
    const me = await get("/me");
    setCsrf(me.csrf);
    setSession(me);
  }
  useEffect(() => {
    (async () => {
      try {
        const status = await get("/auth/owner/setup");
        setSetupRequired(status.required);
        try {
          await reload();
        } catch (e) {
          if (e.status !== 401) throw e;
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    const update = () => {
      const hash = location.hash.slice(1);
      setSection(sections.some(([key]) => key === hash) ? hash : "overview");
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  async function logout() {
    await post("/auth/logout", {});
    setSession(null);
    setCsrf("");
    setMessage("");
  }
  if (loading) return <Loading />;
  if (!session || !session.user.console_access)
    return (
      <div className="owner-auth">
        <aside className="owner-auth-story">
          <OwnerBrand />
          <div>
            <span className="eyebrow">YOUR BUSINESS, IN FOCUS</span>
            <h1>
              One place to run
              <br />
              your SMPIS business.
            </h1>
            <p>
              Follow signups, track subscription revenue, help your customers
              and keep every portal running smoothly.
            </p>
            <div className="owner-auth-points">
              <span>
                <Users /> Customer accounts
              </span>
              <span>
                <Wallet /> Subscription revenue
              </span>
              <span>
                <LifeBuoy /> Customer support
              </span>
              <span>
                <ShieldCheck /> Secure owner controls
              </span>
            </div>
          </div>
          <small>SMPIS owner access</small>
        </aside>
        <main>
          <div className="owner-auth-card">
            <div className="eyebrow">SMPIS OWNER PORTAL</div>
            <h1>
              {setupRequired
                ? "Create your owner account"
                : "Welcome back, owner"}
            </h1>
            <p>
              {setupRequired
                ? "Register yourself to manage the SMPIS business."
                : "Sign in to your business dashboard."}
            </p>
            {error && <p className="form-error">{error}</p>}
            {message && <p className="notice">{message}</p>}
            {!setupRequired && (
              <a href="/login">Verify your email or resend verification</a>
            )}
            {session && !session.user.platform_operator ? (
              <div className="notice">
                <p>
                  You are signed in to a school account. Use an owner account to
                  open this console.
                </p>
                <Button onClick={logout}>Switch to owner sign-in</Button>
                <a href={`/${session.user.portal_slug}/`}>
                  Open your school portal <ArrowUpRight size={14} />
                </a>
              </div>
            ) : (
              <Form
                key={setupRequired ? "setup" : "login"}
                fields={[
                  ...(setupRequired
                    ? [{ name: "name", label: "Your full name", wide: true }]
                    : []),
                  {
                    name: "email",
                    label: "Email address",
                    type: "email",
                    wide: true,
                  },
                  {
                    name: "password",
                    label: "Password",
                    type: "password",
                    minLength: setupRequired ? 12 : undefined,
                    wide: true,
                    autoComplete: setupRequired
                      ? "new-password"
                      : "current-password",
                  },
                ]}
                submit={
                  setupRequired
                    ? "Create owner account"
                    : "Sign in to owner dashboard"
                }
                onSubmit={async (v) => {
                  if (setupRequired) {
                    const created = await post("/auth/owner/setup", v);
                    setMessage(created.message);
                    setSetupRequired(false);
                    return;
                  }
                  const result = await post("/auth/owner/login", {
                    email: v.email,
                    password: v.password,
                  });
                  setCsrf(result.csrf);
                  setSession(result);
                  setError("");
                }}
              />
            )}
            <a className="owner-back-link" href="/">
              Back to SMPIS
            </a>
          </div>
        </main>
      </div>
    );
  if (session.mfa_required)
    return (
      <div className="mfa-card">
        <ShieldCheck size={38} />
        <h1>Verify owner access</h1>
        <p>Enter your authenticator code or a recovery code.</p>
        <Form
          fields={[
            {
              name: "code",
              label: "Verification code",
              wide: true,
              maxLength: 24,
            },
          ]}
          submit="Verify and continue"
          onSubmit={async (v) => {
            await post("/auth/mfa/verify", v);
            await reload();
          }}
        />
        <Button secondary onClick={logout}>
          Sign out
        </Button>
      </div>
    );
  const active = session.user.mfa_setup_required
    ? "security"
    : sections.some(([key]) => key === section)
      ? section
      : sections[0]?.[0] || "security";
  return (
    <div className="owner-shell">
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`owner-sidebar ${mobile ? "open" : ""}`}>
        <OwnerBrand />
        <div className="owner-console-label">OWNER WORKSPACE</div>
        <nav aria-label="Owner navigation">
          {sections
            .filter(
              ([key]) => !session.user.mfa_setup_required || key === "security",
            )
            .map(([key, label, Icon]) => (
              <button
                key={key}
                className={key === active ? "active" : ""}
                onClick={() => {
                  location.hash = key;
                  setSection(key);
                  setMobile(false);
                }}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
        </nav>
        <div className="owner-sidebar-bottom">
          <span>{session.user.name}</span>
          <small>
            {session.user.platform_operator
              ? "Platform owner"
              : scopesLabel(session.user.platform_scope)}
          </small>
          <Button secondary onClick={logout}>
            <LogOut size={15} /> Sign out
          </Button>
        </div>
      </aside>
      <div className="owner-workspace">
        <header className="owner-topbar">
          <button
            className="icon-btn owner-mobile-toggle"
            aria-label="Open owner navigation"
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <div>
            <small>BUSINESS CONSOLE</small>
            <strong>{sections.find(([key]) => key === active)?.[1]}</strong>
          </div>
          <NotificationBell
            onClick={() => {
              location.hash = "inbox";
              setSection("inbox");
            }}
          />
          <span className="owner-access-pill">
            <ShieldCheck size={14} />{" "}
            {session.user.platform_operator
              ? "Owner access"
              : "Delegated access"}
          </span>
        </header>
        <main className="owner-content">
          {active === "security" ? (
            <OwnerSecurity session={session} reload={reload} />
          ) : active === "communications" ? (
            <OwnerCommunications />
          ) : active === "email-templates" ? (
            <EmailTemplates notify={setMessage} />
          ) : active === "inbox" ? (
            <PlatformInbox />
          ) : active === "team" ? (
            <PlatformTeam notify={setMessage} />
          ) : active === "issues" ? (
            <OwnerIssues notify={setMessage} />
          ) : active === "tenants" ? (
            session.user.platform_operator ? (
              <>
                <SaasOwner
                  key={`${active}-${tenantRevision}`}
                  section={active}
                  notify={setMessage}
                />
                <ManagedSchools
                  fullOwner
                  onlyDeletion
                  onChange={() => setTenantRevision((value) => value + 1)}
                  notify={setMessage}
                />
              </>
            ) : (
              <ManagedSchools notify={setMessage} />
            )
          ) : (
            <SaasOwner key={active} section={active} notify={setMessage} />
          )}
        </main>
        {message && (
          <div className="toast" role="status">
            <span>{message}</span>
            <button
              className="icon-btn"
              aria-label="Dismiss notification"
              onClick={() => setMessage("")}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
