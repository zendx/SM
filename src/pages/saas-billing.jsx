import { TenantAccountControls } from "./platform-team";
import React, { useState, useEffect } from "react";
import {
  Wallet,
  Clock,
  Building2,
  ShieldCheck,
  ArrowUpRight,
  Users,
  LifeBuoy,
} from "lucide-react";
import {
  Form,
  Button,
  Panel,
  PageHead,
  Table,
  Badge,
  Loading,
  Modal,
  Metric,
} from "../components";
import { get, post, patch } from "../api";
import { useData } from "../hooks";
import {
  registrationFields,
  billingCycles,
  subscriptionMoney,
  planPrice,
} from "./saas-public";
import { OwnerAccounts, OwnerIssues } from "./owner-support";

const when = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const providerLabels = {
  stripe: "Stripe",
  paystack: "Paystack",
  flutterwave: "Flutterwave",
};
function PaymentTable({ payments, review }) {
  return (
    <Table
      rows={payments}
      columns={[
        ...(review ? [{ label: "School", key: "school_name" }] : []),
        { label: "Reference", key: "reference" },
        { label: "Plan period", key: "billing_cycle" },
        {
          label: "Payable amount",
          render: (p) =>
            new Intl.NumberFormat("en", {
              style: "currency",
              currency: p.charge_currency || "USD",
            }).format(Number(p.charge_amount_cents || p.amount_cents) / 100),
        },
        {
          label: "Method",
          render: (p) =>
            p.method === "BANK"
              ? "Bank transfer"
              : `${providerLabels[p.provider] || "Card"} (${p.mode})`,
        },
        { label: "Status", render: (p) => <Badge value={p.status} /> },
        { label: "Transfer reference", key: "transfer_reference" },
        { label: "Submitted", render: (p) => when(p.created_at) },
        ...(review
          ? [
              {
                label: "Review",
                render: (p) =>
                  p.method === "BANK" && p.status === "PENDING" ? (
                    <Button small secondary onClick={() => review(p)}>
                      Review transfer
                    </Button>
                  ) : p.status === "REVIEW" ? (
                    <span>Received; access withheld</span>
                  ) : null,
              },
            ]
          : []),
      ]}
    />
  );
}
export function Subscription({
  user,
  reloadSubscription,
  notify = () => {},
  blocked = false,
}) {
  const q = useData("/subscription", null),
    [cycle, setCycle] = useState("MONTHLY"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const provider = params.get("subscription_provider") || "stripe";
    if (
      user.role !== "SUPER_ADMIN" ||
      !(
        params.get("checkout_session") ||
        params.get("reference") ||
        params.get("transaction_id")
      )
    )
      return;
    let alive = true;
    post("/subscription/verify", {
      provider,
      session_id: params.get("checkout_session") || undefined,
      reference: params.get("reference") || undefined,
      transaction_id: params.get("transaction_id") || undefined,
    })
      .then((p) => {
        if (alive) {
          setMessage(
            p.status === "TEST_CONFIRMED"
              ? "Sandbox payment confirmed. No live revenue or paid access was created."
              : p.status === "PAID"
                ? "Payment verified. Pro is active."
                : `Payment status: ${p.status}.`,
          );
          q.reload();
          reloadSubscription?.();
          for (const key of [
            "checkout_session",
            "subscription_provider",
            "reference",
            "trxref",
            "transaction_id",
            "tx_ref",
            "status",
          ])
            params.delete(key);
          history.replaceState(
            {},
            "",
            location.pathname +
              (params.size ? "?" + params.toString() : "") +
              "#subscription",
          );
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (q.loading && !q.data) return <Loading />;
  if (!q.data) return <p className="form-error">{q.error}</p>;
  const sub = q.data,
    admin = user.role === "SUPER_ADMIN",
    amount = planPrice(cycle, q.data.settings);
  const usd = (value) => subscriptionMoney(value, sub.settings);
  const config = sub.settings,
    bankReady = !!(
      config.bank_enabled &&
      config.bank_name &&
      config.account_name &&
      config.account_number
    );
  const canPay =
    sub.status !== "TERMINATED" &&
    !(
      sub.status === "SUSPENDED" &&
      !["TRIAL_EXPIRED", "OVERDUE"].includes(sub.suspension_reason)
    );
  return (
    <div className={blocked ? "billing-blocked" : ""}>
      <PageHead
        eyebrow="YOUR SCHOOL SUBSCRIPTION"
        title="Keep your school connected"
        description={`Free for 30 days. Pro is ${usd(planPrice("MONTHLY", sub.settings))}/month or ${usd(planPrice("YEARLY", sub.settings))}/year.`}
      />
      {blocked && (
        <div className="notice">
          <strong>School access is paused.</strong>{" "}
          {sub.deletion_requested_at
            ? "Administrator Support remains available until the account closure deadline."
            : sub.suspension_reason === "TENANT_PAUSED"
              ? "Resume your subscription below when you are ready; the expiry date is unchanged."
              : "Billing remains available so your administrator can renew."}{" "}
          {sub.suspension_reason === "MANUAL" || sub.status === "TERMINATED"
            ? "Contact the SMPIS owner to resolve this subscription."
            : "Your school records are retained."}
        </div>
      )}
      {(error || q.error) && (
        <p className="form-error" role="alert">
          {error || q.error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="metrics">
        <Metric
          label="Current plan"
          value={sub.plan === "FREE" ? "Free trial" : "Pro"}
          detail={sub.school_name}
          icon={Building2}
        />
        <Metric
          label="Subscription status"
          value={sub.status.replaceAll("_", " ")}
          detail={
            sub.suspension_reason.replaceAll("_", " ") ||
            "Your school subscription"
          }
          icon={ShieldCheck}
        />
        <Metric
          label="Access expiry"
          value={new Date(sub.period_end).toLocaleDateString()}
          detail={
            sub.plan === "FREE"
              ? "30-day trial"
              : `${config.grace_days} grace days after expiry`
          }
          icon={Clock}
        />
      </div>
      {admin && canPay ? (
        <>
          <Panel title="Choose your Pro period">
            <div className="billing-period">
              <label>
                Billing period{" "}
                <select
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                >
                  {billingCycles(config).map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <strong>
                {usd(amount)}{" "}
                <small>
                  {config.landing_currency}{" "}
                  {cycle === "YEARLY" ? "for one year" : "for one month"}
                </small>
              </strong>
            </div>
            <p className="muted">
              Payments cover one billing period. Renew when due; cards are not
              charged automatically. Switching period applies to your next
              purchase and preserves remaining paid time.
            </p>
          </Panel>
          <div className="billing-methods">
            {Object.keys(sub.providers).length > 0 && (
              <Panel
                title="Pay by card"
                description="Choose a payment provider. Your subscription activates after server verification."
              >
                {Object.entries(sub.providers).map(([name, p]) => (
                  <div className="provider-choice" key={name}>
                    <div>
                      <strong>{providerLabels[name]}</strong>
                      <small>
                        {p.enabled
                          ? p.mode === "SANDBOX"
                            ? "Sandbox · no real charge"
                            : `Live · ${p.currency}`
                          : "Not configured"}
                      </small>
                      {p.enabled && p.currency === "NGN" && (
                        <small>
                          ₦
                          {(
                            (amount / 100) *
                            Number(p.usd_rate)
                          ).toLocaleString()}{" "}
                          at ₦{Number(p.usd_rate).toLocaleString()} / $1
                        </small>
                      )}
                    </div>
                    <Button
                      small
                      disabled={!p.enabled || busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await post("/subscription/checkout", {
                            billing_cycle: cycle,
                            provider: name,
                          });
                          location.assign(result.url);
                        } catch (e) {
                          setError(e.message);
                          setBusy(false);
                        }
                      }}
                    >
                      {p.mode === "SANDBOX" ? "Test checkout" : "Pay by card"}{" "}
                      <ArrowUpRight size={15} />
                    </Button>
                  </div>
                ))}
              </Panel>
            )}
            {bankReady && (
              <Panel
                title="Pay by bank transfer"
                description="Transfer to the owner’s account, then submit the bank reference for approval."
              >
                {bankReady ? (
                  <>
                    <dl className="bank-details">
                      <dt>Bank</dt>
                      <dd>{config.bank_name}</dd>
                      <dt>Account name</dt>
                      <dd>{config.account_name}</dd>
                      <dt>Account number</dt>
                      <dd>{config.account_number}</dd>
                      <dt>Transfer amount</dt>
                      <dd>
                        {new Intl.NumberFormat("en", {
                          style: "currency",
                          currency: config.landing_currency,
                        }).format(
                          (amount / 100) *
                            (config.landing_currency === "USD"
                              ? 1
                              : Number(config.landing_usd_rate)),
                        )}
                      </dd>
                    </dl>
                    <p>{config.bank_instructions}</p>
                    <Form
                      key={cycle}
                      fields={[
                        {
                          name: "transfer_reference",
                          label: "Bank transfer reference",
                          wide: true,
                        },
                        {
                          name: "note",
                          label: "Payment note",
                          type: "textarea",
                          required: false,
                          wide: true,
                        },
                      ]}
                      submit="Submit transfer for approval"
                      onSubmit={async (v) => {
                        await post("/subscription/bank", {
                          ...v,
                          billing_cycle: cycle,
                        });
                        setMessage(
                          "Transfer submitted. Pro starts after the SMPIS owner confirms receipt.",
                        );
                        q.reload();
                      }}
                    />
                  </>
                ) : (
                  <p className="notice">
                    Bank details have not been published yet. Contact the SMPIS
                    owner.
                  </p>
                )}
              </Panel>
            )}
            {!bankReady && !Object.keys(sub.providers).length && (
              <p className="notice">
                Subscription payments are not available yet. Contact SMPIS
                support.
              </p>
            )}
          </div>
        </>
      ) : !admin ? (
        <p className="notice">
          Your school administrator manages this subscription. Contact them
          about payment or access.
        </p>
      ) : null}
      <Panel
        title="Subscription payment history"
        description="These are payments to SMPIS, separate from your school’s student fee collection."
      >
        <PaymentTable payments={sub.payments} />
      </Panel>
      {admin && !user.platform_operator && (
        <TenantAccountControls
          sub={sub}
          reload={() => {
            q.reload();
            reloadSubscription?.();
          }}
        />
      )}
    </div>
  );
}
export function SaasOwner({ notify = () => {}, section }) {
  const q = useData("/saas/owner", null),
    [create, setCreate] = useState(false),
    [action, setAction] = useState(null),
    [review, setReview] = useState(null),
    [provider, setProvider] = useState(null),
    [tab, setTab] = useState(section || "overview"),
    [chartMode, setChartMode] = useState("revenue"),
    [selectedMonth, setSelectedMonth] = useState(null);
  if (q.loading && !q.data) return <Loading />;
  if (!q.data) return <p className="form-error">{q.error}</p>;
  const d = q.data;
  const usd = (value) => subscriptionMoney(value, d.settings);
  return (
    <>
      <PageHead
        eyebrow="SMPIS OWNER"
        title={
          tab === "overview"
            ? "Your business, at a glance."
            : {
                tenants: "Schools & subscriptions",
                users: "Customer accounts",
                payments: "Payments & revenue",
                settings: "Payment settings",
                issues: "Customer support",
                audit: "Audit history",
              }[tab] || "SMPIS business"
        }
        description="Track customers, subscription revenue and the work that keeps your business moving."
      >
        <a
          className="btn secondary"
          href="/api/v1/saas/owner/export?kind=payments"
        >
          Export payments
        </a>
        <a
          className="btn secondary"
          href="/api/v1/saas/owner/export?kind=audit"
        >
          Export audit
        </a>
        <Button onClick={() => setCreate(true)}>Create school portal</Button>
      </PageHead>
      {q.error && <p className="form-error">{q.error}</p>}
      <div className="metrics">
        <Metric
          label="Registered schools"
          value={d.metrics.registered_schools}
          detail={`${d.metrics.signups_this_month} signups this month`}
          icon={Building2}
        />
        <Metric
          label="Customer user accounts"
          value={d.metrics.user_accounts}
          detail="Accounts across your customer schools"
          icon={Users}
        />
        <Metric
          label="Schools that have paid"
          value={d.metrics.paid_schools}
          detail={`${d.metrics.active_pro_schools} active Pro subscriptions`}
          icon={ShieldCheck}
        />
        <Metric
          label="Total received"
          value={usd(d.revenue.received_cents)}
          detail="Confirmed live receipts · USD equivalent"
          icon={Wallet}
        />
        <Metric
          label="Received this month"
          value={usd(d.revenue.month_cents)}
          detail="Confirmed payments this calendar month"
          icon={Wallet}
        />
        <Metric
          label="Transfers awaiting review"
          value={usd(d.revenue.pending_bank_cents)}
          detail="Not counted as received revenue"
          icon={Clock}
        />
      </div>
      {!section && (
        <div
          className="saas-tabs"
          role="group"
          aria-label="Owner dashboard sections"
        >
          {[
            ["overview", "Business overview"],
            ["tenants", "School portals"],
            ["users", "Customer accounts"],
            ["issues", "Customer support"],
            ["payments", "Payments & revenue"],
            ["settings", "Payment settings"],
            ["audit", "Audit history"],
          ].map(([key, title]) => (
            <Button
              key={key}
              secondary={tab !== key}
              onClick={() => setTab(key)}
            >
              {title}
            </Button>
          ))}
        </div>
      )}
      {tab === "overview" && (
        <>
          <div className="owner-overview-grid">
            <Panel
              title="Business growth"
              description="Actual customer signups and confirmed receipts over the last six months."
            >
              <div className="owner-chart-controls">
                <Button
                  small
                  secondary={chartMode !== "revenue"}
                  onClick={() => setChartMode("revenue")}
                >
                  Revenue
                </Button>
                <Button
                  small
                  secondary={chartMode !== "signups"}
                  onClick={() => setChartMode("signups")}
                >
                  Signups
                </Button>
              </div>
              <div className="owner-growth-chart">
                {d.activity.map((item) => {
                  const value = Number(
                      chartMode === "revenue"
                        ? item.revenue_cents
                        : item.signups,
                    ),
                    max = Math.max(
                      1,
                      ...d.activity.map((x) =>
                        Number(
                          chartMode === "revenue" ? x.revenue_cents : x.signups,
                        ),
                      ),
                    );
                  const label = new Date(
                    item.month + "-01T12:00:00Z",
                  ).toLocaleDateString(undefined, { month: "short" });
                  return (
                    <button
                      key={item.month}
                      aria-label={`${item.month}: ${chartMode === "revenue" ? usd(value) : value + " signups"}`}
                      title={`${item.month}: ${chartMode === "revenue" ? usd(value) : value + " signups"}`}
                      onClick={() => setSelectedMonth(item.month)}
                      className={selectedMonth === item.month ? "selected" : ""}
                    >
                      <strong>
                        {chartMode === "revenue" ? usd(value) : value}
                      </strong>
                      <span className="growth-track">
                        <i
                          style={{
                            height: `${Math.max(2, (value / max) * 100)}%`,
                          }}
                        />
                      </span>
                      <small>{label}</small>
                    </button>
                  );
                })}
              </div>
              <p className="owner-chart-caption">
                {selectedMonth ? `Viewing ${selectedMonth}. ` : ""}
                {chartMode === "revenue"
                  ? `Receipts in ${d.settings.landing_currency} equivalents at the current rate. Sandbox payments are excluded.`
                  : "School registrations, excluding the owner workspace."}
              </p>
            </Panel>
            <Panel title="What needs your attention">
              <div className="owner-attention">
                <a href="#issues">
                  <LifeBuoy size={22} />
                  <div>
                    <strong>{d.metrics.open_issues} open support issues</strong>
                    <span>Help customers get back to work</span>
                  </div>
                  <ArrowUpRight size={17} />
                </a>
                <a href="#payments">
                  <Clock size={22} />
                  <div>
                    <strong>
                      {usd(d.revenue.pending_bank_cents)} awaiting review
                    </strong>
                    <span>Confirm bank payments before activation</span>
                  </div>
                  <ArrowUpRight size={17} />
                </a>
                <div>
                  <ShieldCheck size={22} />
                  <div>
                    <strong>{d.metrics.trial_schools} schools in trial</strong>
                    <span>
                      {d.metrics.paid_schools} of {d.metrics.registered_schools}{" "}
                      schools have paid
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
          <Panel title="Recent customer signups">
            <Table
              rows={d.tenants.filter((t) => !t.owner_school).slice(0, 6)}
              columns={[
                { label: "School", key: "name" },
                { label: "Portal", render: (t) => `/${t.portal_slug}/` },
                { label: "Registered", render: (t) => when(t.created_at) },
                {
                  label: "Subscription",
                  render: (t) => <Badge value={t.status} />,
                },
                { label: "Received", render: (t) => usd(t.received_cents) },
              ]}
            />
          </Panel>
        </>
      )}
      {tab === "users" && <OwnerAccounts notify={notify} />}
      {tab === "issues" && <OwnerIssues notify={notify} />}
      {tab === "tenants" && (
        <Panel
          title="School subscriptions"
          description="Manual suspensions require owner restoration. Verified renewals restore subscriptions suspended for expiry."
        >
          <Table
            rows={d.tenants.filter((t) => !t.owner_school)}
            columns={[
              {
                label: "School",
                render: (t) => (
                  <div>
                    <strong>{t.name}</strong>
                    <small className="table-sub">
                      {t.owner_school
                        ? "Owner workspace"
                        : `${t.students} enrolled students`}
                    </small>
                  </div>
                ),
              },
              {
                label: "Portal",
                render: (t) => (
                  <a href={`/${t.portal_slug}/`}>
                    /{t.portal_slug}/ <ArrowUpRight size={12} />
                  </a>
                ),
              },
              {
                label: "Plan",
                render: (t) =>
                  t.plan === "FREE"
                    ? "Free · 30-day trial"
                    : `Pro · ${t.billing_cycle.toLowerCase()}`,
              },
              {
                label: "Status",
                render: (t) =>
                  t.owner_school ? (
                    <span>Owner access</span>
                  ) : (
                    <>
                      <Badge value={t.status} />
                      <small className="table-sub">
                        {t.suspension_reason.replaceAll("_", " ")}
                      </small>
                    </>
                  ),
              },
              { label: "Expiry", render: (t) => when(t.period_end) },
              { label: "Received", render: (t) => usd(t.received_cents) },
              {
                label: "Manage",
                render: (t) =>
                  t.deletion_requested_at ? (
                    <span>Use account reactivation below</span>
                  ) : !t.owner_school && t.status !== "TERMINATED" ? (
                    <div className="toolbar">
                      {t.status === "SUSPENDED" ? (
                        <Button
                          small
                          secondary
                          onClick={() =>
                            setAction({ tenant: t, action: "RESTORE" })
                          }
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          small
                          secondary
                          onClick={() =>
                            setAction({ tenant: t, action: "SUSPEND" })
                          }
                        >
                          Suspend
                        </Button>
                      )}
                      <Button
                        small
                        secondary
                        onClick={() =>
                          setAction({ tenant: t, action: "TERMINATE" })
                        }
                      >
                        Terminate
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </Panel>
      )}
      {tab === "payments" && (
        <>
          <Panel
            title="Subscription payments"
            description="Approve bank transfers only after checking your bank statement. Test payments do not count as revenue."
          >
            <PaymentTable payments={d.payments} review={setReview} />
          </Panel>
          <Panel
            title="Monthly receipts"
            description={`Totals in ${d.settings.landing_currency} equivalents; payment rows retain the original currency and amount collected.`}
          >
            <Table
              rows={d.monthly}
              keyField="month"
              columns={[
                { label: "Month", key: "month" },
                { label: "Received", render: (r) => usd(r.received_cents) },
              ]}
            />
          </Panel>
        </>
      )}
      {tab === "settings" && (
        <>
          <Panel title="Manual bank payments & late-payment policy">
            <Form
              key={d.settings.updated_at}
              initial={{
                ...d.settings,
                monthly_price_usd: d.settings.monthly_price_cents / 100,
              }}
              fields={[
                {
                  name: "monthly_price_usd",
                  label: "Monthly Pro price (USD)",
                  type: "number",
                  min: 0.01,
                  max: 1000000,
                  step: 0.01,
                  hint: "Yearly pricing is calculated automatically at 15% off twelve monthly payments.",
                },
                {
                  name: "landing_currency",
                  label: "Global subscription currency",
                  options: ["USD", "NGN"],
                  hint: "Applies to public pricing, signup, subscriptions and new payments.",
                },
                {
                  name: "landing_usd_rate",
                  label: "Global exchange rate",
                  type: "number",
                  min: 0.000001,
                  step: "any",
                  hint: "NGN per USD. Your monthly and yearly base prices are converted using this rate.",
                },
                {
                  name: "bank_enabled",
                  label: "Manual subscription payments available (live)",
                  type: "checkbox",
                },
                { name: "bank_name", label: "Bank name", required: false },
                {
                  name: "account_name",
                  label: "Account name",
                  required: false,
                },
                {
                  name: "account_number",
                  label: "Account number",
                  required: false,
                },
                {
                  name: "grace_days",
                  label: "Pro late-payment grace days",
                  type: "number",
                  min: 0,
                  max: 30,
                },
                {
                  name: "bank_instructions",
                  label: "Bank transfer instructions",
                  type: "textarea",
                  wide: true,
                  required: false,
                },
              ]}
              onSubmit={async (v) => {
                const { monthly_price_usd, ...fields } = v;
                await patch("/saas/owner/settings", {
                  ...fields,
                  monthly_price_cents: Math.round(
                    Number(monthly_price_usd) * 100,
                  ),
                });
                q.reload();
                notify("Payment settings updated.");
              }}
              submit="Save bank & subscription settings"
            />
            <p className="muted">
              The Free trial always expires at 30 days. Pro suspends
              automatically after its expiry plus the configured grace days.
              Manual transfers require complete bank details and the
              availability switch. Disabled and sandbox card providers stay
              hidden from tenants.
            </p>
          </Panel>
          <Panel
            title="Card payment providers"
            description="Owner payment credentials are encrypted and separate from each school’s student fee integrations."
          >
            <div className="provider-grid">
              {Object.entries(d.providers).map(([name, p]) => (
                <article key={name}>
                  <h3>{providerLabels[name]}</h3>
                  <Badge value={p.enabled ? "ACTIVE" : "PENDING"} />
                  <p>
                    {p.mode === "LIVE" ? "Live mode" : "Sandbox mode"} ·{" "}
                    {p.currency}
                  </p>
                  <small>
                    {p.secret_key_configured
                      ? "Secret key saved"
                      : "No secret key saved"}
                  </small>
                  <Button
                    secondary
                    onClick={() => setProvider({ name, config: p })}
                  >
                    Configure {providerLabels[name]}
                  </Button>
                  <p className="muted">
                    Webhook: <code>/api/v1/saas/webhooks/{name}</code>
                  </p>
                </article>
              ))}
            </div>
          </Panel>
        </>
      )}
      {tab === "audit" && (
        <Panel
          title="Subscription audit trail"
          description="Includes automatic suspension, payment reviews, provider settings and owner actions."
        >
          <Table
            rows={d.events}
            columns={[
              { label: "Time", render: (e) => when(e.created_at) },
              { label: "School", key: "school_name" },
              { label: "Action", key: "action" },
              { label: "Actor", render: (e) => e.actor_name || "System" },
              {
                label: "Details",
                render: (e) => (
                  <code className="audit-detail">
                    {JSON.stringify(e.details)}
                  </code>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {create && (
        <Modal title="Create school portal" onClose={() => setCreate(false)}>
          <Form
            fields={registrationFields("FREE", "MONTHLY", d.settings)}
            submit="Create school"
            onSubmit={async (v) => {
              const result = await post("/saas/owner/tenants", v);
              setCreate(false);
              q.reload();
              notify(
                `School created at ${result.portal_url}. Share the credentials securely.`,
              );
            }}
          />
        </Modal>
      )}
      {action && (
        <Modal
          title={`${action.action === "RESTORE" ? "Restore" : action.action === "SUSPEND" ? "Suspend" : "Terminate"} ${action.tenant.name}`}
          onClose={() => setAction(null)}
        >
          <p>
            {action.action === "TERMINATE"
              ? "Termination disables school access and retains records. It cannot be undone from this dashboard."
              : action.action === "SUSPEND"
                ? "This immediately blocks operational access. Payments cannot override a manual suspension."
                : action.tenant.plan === "FREE"
                  ? "Restoration keeps the original 30-day trial expiry. If the trial has ended, access stays paused and Pro payment becomes available."
                  : "Choose how long access should remain available. Extending access here does not record revenue."}
          </p>
          <Form
            fields={[
              { name: "reason", label: "Reason", type: "textarea", wide: true },
              ...(action.action === "RESTORE" && action.tenant.plan !== "FREE"
                ? [
                    {
                      name: "access_until",
                      label: "Access expiry",
                      type: "date",
                      default: new Date(
                        Math.max(
                          new Date(action.tenant.period_end).getTime(),
                          Date.now() + 86400000 * 30,
                        ),
                      )
                        .toISOString()
                        .slice(0, 10),
                      wide: true,
                    },
                  ]
                : []),
            ]}
            submit={
              action.action === "TERMINATE"
                ? "Confirm termination"
                : action.action === "RESTORE"
                  ? "Restore subscription"
                  : "Suspend subscription"
            }
            onSubmit={async (v) => {
              await patch(`/saas/owner/tenants/${action.tenant.school_id}`, {
                ...v,
                action: action.action,
                ...(v.access_until
                  ? {
                      access_until: new Date(
                        v.access_until + "T23:59:59Z",
                      ).toISOString(),
                    }
                  : {}),
              });
              setAction(null);
              q.reload();
              notify("Subscription updated.");
            }}
          />
        </Modal>
      )}
      {review && (
        <Modal
          title={`Review transfer — ${review.school_name}`}
          onClose={() => setReview(null)}
        >
          <dl className="bank-details">
            <dt>Subscription value</dt>
            <dd>{usd(review.amount_cents)}</dd>
            <dt>Expected transfer</dt>
            <dd>
              {review.charge_currency}{" "}
              {(Number(review.charge_amount_cents) / 100).toLocaleString()}
            </dd>
            <dt>Transfer reference</dt>
            <dd>{review.transfer_reference}</dd>
            <dt>School note</dt>
            <dd>{review.note || "—"}</dd>
          </dl>
          <p>Confirm the actual funds in your bank account before approving.</p>
          <Form
            fields={[
              {
                name: "decision",
                label: "Decision",
                options: [
                  { value: "APPROVE", label: "Approve — funds received" },
                  { value: "REJECT", label: "Reject — payment not verified" },
                ],
              },
              {
                name: "note",
                label: "Review note",
                type: "textarea",
                wide: true,
              },
            ]}
            submit="Save payment decision"
            onSubmit={async (v) => {
              await post(`/saas/owner/payments/${review.id}/review`, v);
              setReview(null);
              q.reload();
              notify("Payment reviewed.");
            }}
          />
        </Modal>
      )}
      {provider && (
        <Modal
          title={`Configure ${providerLabels[provider.name]}`}
          onClose={() => setProvider(null)}
        >
          <p>
            Use your provider’s sandbox credentials first. Leave a saved secret
            blank to keep it. Live mode requires matching live credentials.
          </p>
          <Form
            initial={provider.config}
            fields={[
              {
                name: "enabled",
                label: "Enable this provider",
                type: "checkbox",
              },
              {
                name: "mode",
                label: "Payment mode",
                options: [
                  { value: "SANDBOX", label: "Sandbox" },
                  { value: "LIVE", label: "Live" },
                ],
              },
              {
                name: "secret_key",
                label: "Secret key",
                type: "password",
                required: false,
                wide: true,
              },
              {
                name: "webhook_secret",
                label:
                  provider.name === "paystack"
                    ? "Webhook secret (enter your Paystack secret key)"
                    : "Webhook signing secret / hash",
                type: "password",
                required: false,
                wide: true,
              },
              {
                name: "clear_secrets",
                label: "Remove saved credentials",
                type: "checkbox",
                required: false,
              },
            ]}
            submit="Save provider configuration"
            onSubmit={async (v) => {
              await patch(`/saas/owner/providers/${provider.name}`, v);
              setProvider(null);
              q.reload();
              notify("Provider configuration saved.");
            }}
          />
        </Modal>
      )}
    </>
  );
}
