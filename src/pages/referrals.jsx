import React, { useEffect, useState } from "react";
import { BrandLogo } from "../brand-logo";
import { get, post, patch, setCsrf } from "../api";
import { useData } from "../hooks";
import {
  Form,
  Button,
  Panel,
  Table,
  Modal,
  Loading,
  Badge,
} from "../components";
import "../saas.css";

const bankFields = [
  { name: "bank_name", label: "Bank name" },
  { name: "account_number", label: "Account number", maxLength: 34 },
  { name: "account_name", label: "Account name", wide: true },
];
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
const money = (amount, currency) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    Number(amount) / 100,
  );
function CommissionHistory({ rows, owner, onPay }) {
  return (
    <Table
      rows={rows}
      empty={{
        title: "No commissions yet",
        description:
          "Commission appears after a referred school makes its first approved subscription payment.",
      }}
      columns={[
        ...(owner ? [{ label: "Marketer", key: "marketer_name" }] : []),
        { label: "School", key: "school_name" },
        {
          label: "Payment",
          render: (r) => money(r.payment_amount_cents, r.currency),
        },
        { label: "Rate", render: (r) => `${r.percent}%` },
        {
          label: "Commission",
          render: (r) => money(r.amount_cents, r.currency),
        },
        { label: "Status", render: (r) => <Badge value={r.status} /> },
        { label: "Due by", render: (r) => date(r.due_at) },
        { label: "Paid", render: (r) => date(r.paid_at) },
        { label: "Transfer reference", key: "payment_reference" },
        {
          label: "Paid to",
          render: (r) =>
            r.status === "PAID"
              ? `${r.bank_name} / ${r.account_name} / ${r.account_number}`
              : "—",
        },
        ...(owner
          ? [
              {
                label: "Action",
                render: (r) =>
                  r.status === "PENDING" ? (
                    <Button secondary onClick={() => onPay(r)}>
                      Record payment
                    </Button>
                  ) : null,
              },
            ]
          : []),
      ]}
    />
  );
}
function Totals({ rows }) {
  const totals = {};
  for (const row of rows) {
    const t = (totals[row.currency] ||= { pending: 0, paid: 0 });
    t[row.status === "PAID" ? "paid" : "pending"] += Number(row.amount_cents);
  }
  return (
    <div className="referral-totals">
      {Object.entries(totals).map(([currency, t]) => (
        <div className="notice" key={currency}>
          <strong>{currency}</strong>
          <p>Awaiting payment: {money(t.pending, currency)}</p>
          <p>Paid: {money(t.paid, currency)}</p>
        </div>
      ))}
    </div>
  );
}
export function OwnerReferrals() {
  const q = useData("/saas/owner/referrals", null),
    [selected, setSelected] = useState(null);
  if (q.error) return <p className="form-error">{q.error}</p>;
  if (!q.data) return <Loading />;
  return (
    <>
      <Panel
        title="Marketer referral program"
        description="Set commissions for future approved subscription payments. Existing earned commissions retain their original rate. Transfers are made outside SMPIS; record them here after sending."
      >
        <a href="/marketers" target="_blank" rel="noreferrer">
          Open marketer signup and portal
        </a>
        <Form
          key={JSON.stringify(q.data.program)}
          initial={q.data.program}
          fields={[
            {
              name: "referral_percent",
              label: "Commission percentage",
              type: "number",
              min: 0,
              max: 100,
              step: 0.01,
              hint: "Set to 0 to pause new commission earnings.",
            },
          ]}
          submit="Save referral settings"
          onSubmit={async (v) => {
            await patch("/saas/owner/referrals/settings", v);
            q.reload();
          }}
        />
      </Panel>
      <Panel title="Marketers">
        <Table
          rows={q.data.marketers}
          columns={[
            { label: "Name", key: "name" },
            { label: "Email", key: "email" },
            { label: "Code", key: "code" },
            { label: "School signups", key: "signups" },
            {
              label: "Status",
              render: (r) =>
                r.closed_at
                  ? "Closed"
                  : r.email_verified
                    ? "Active"
                    : "Awaiting email verification",
            },
            { label: "Bank", key: "bank_name" },
            { label: "Account name", key: "account_name" },
            { label: "Account number", key: "account_number" },
          ]}
        />
      </Panel>
      <Panel
        title="Commissions and payout history"
        description="Target payment time is three working days after approval (Monday to Friday). Amounts are kept in the currency actually paid."
      >
        <Totals rows={q.data.commissions} />
        <CommissionHistory
          rows={q.data.commissions}
          owner
          onPay={setSelected}
        />
      </Panel>
      {selected && (
        <Modal
          title="Record commission payment"
          onClose={() => setSelected(null)}
        >
          <p>
            Record the {money(selected.amount_cents, selected.currency)} already
            sent to {selected.marketer_name}. Confirm the destination bank
            details against the transfer.
          </p>
          <Form
            initial={{
              bank_name: selected.current_bank_name,
              account_number: selected.current_account_number,
              account_name: selected.current_account_name,
            }}
            fields={[
              ...bankFields,
              {
                name: "payment_reference",
                label: "Bank transfer reference",
                wide: true,
              },
            ]}
            submit="Confirm paid"
            onSubmit={async (v) => {
              await post(`/saas/owner/referrals/${selected.id}/paid`, v);
              setSelected(null);
              q.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function MarketerPortal() {
  const [session, setSession] = useState(null),
    [loading, setLoading] = useState(true),
    [signup, setSignup] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false);
  const program = useData("/referrals/program", null);
  const q = useData(
    session?.user.role === "MARKETER" && !session.mfa_required
      ? "/referrals/account"
      : null,
    null,
  );
  useEffect(() => {
    get("/me")
      .then((s) => {
        setCsrf(s.csrf);
        setSession(s);
      })
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    await post("/auth/logout", {});
    setSession(null);
    q.setData(null);
    setCsrf("");
  }
  if (loading) return <Loading />;
  const account = q.data?.account;
  const link = account
    ? `${location.origin}/signup?ref=${encodeURIComponent(account.code)}`
    : "";
  return (
    <div className="referral-shell">
      <header className="referral-header">
        <a href="/">
          <BrandLogo />
        </a>
        <a href="/">SMPIS home</a>
      </header>
      <h1>Marketer referral portal</h1>
      {error && <p className="form-error">{error}</p>}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!session ? (
        <Panel
          title={
            signup
              ? "Create a marketer account"
              : "Sign in to your referral account"
          }
        >
          <p>
            Share your referral link, track school signups and follow your
            commission payments.
          </p>
          {program.data && (
            <p>
              Current commission: {program.data.referral_percent}% of the first
              approved subscription payment. Payment is due within three working
              days (Monday to Friday). Rates in effect at payment approval
              apply.
            </p>
          )}
          <Form
            key={signup ? "signup" : "login"}
            recaptcha={signup ? "signup" : "login"}
            fields={[
              ...(signup
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
                minLength: signup ? 12 : undefined,
                wide: true,
              },
              ...(signup
                ? [
                    {
                      name: "confirm_password",
                      label: "Confirm password",
                      type: "password",
                      matches: "password",
                      clientOnly: true,
                      wide: true,
                    },
                    {
                      name: "privacy_accepted",
                      label: "I have read and accept the privacy policy",
                      type: "checkbox",
                      default: false,
                      required: true,
                      wide: true,
                    },
                  ]
                : []),
            ]}
            submit={signup ? "Create marketer account" : "Sign in"}
            onSubmit={async (v) => {
              if (signup) {
                setMessage((await post("/referrals/register", v)).message);
                setSignup(false);
              } else {
                const s = await post("/auth/login", v);
                if (s.user.role !== "MARKETER") {
                  setCsrf(s.csrf);
                  setSession(s);
                  return;
                }
                setCsrf(s.csrf);
                setSession(s);
                setMessage("");
              }
            }}
          />
          <Button secondary onClick={() => setSignup(!signup)}>
            {signup
              ? "Already registered? Sign in"
              : "Join the referral program"}
          </Button>
          <p>
            <a href="/login">
              Verify email, resend verification or reset password
            </a>{" "}
            · <a href="/privacy">Privacy policy</a>
          </p>
        </Panel>
      ) : session.user.role !== "MARKETER" ? (
        <Panel title="Use a marketer account">
          <p>You are signed in to another account.</p>
          <Button onClick={logout}>Sign out and switch account</Button>
        </Panel>
      ) : session.mfa_required ? (
        <Panel title="Verify your account">
          <Form
            fields={[{ name: "code", label: "Authenticator or recovery code" }]}
            submit="Verify"
            onSubmit={async (v) => {
              await post("/auth/mfa/verify", v);
              const s = await get("/me");
              setSession(s);
            }}
          />
        </Panel>
      ) : (
        <>
          <div className="row-actions">
            <span>
              {account?.name || session.user.name} · {session.user.email}
            </span>
            <Button secondary onClick={logout}>
              Sign out
            </Button>
          </div>
          {q.error && <p className="form-error">{q.error}</p>}
          {!q.data ? (
            <Loading />
          ) : (
            <>
              {account.closed_at ? (
                <p className="notice">
                  Your referral account is closed. Your history remains
                  available, and previously earned commissions can still be
                  paid. Your code no longer accepts new signups.
                </p>
              ) : (
                <Panel title="Your referral link and code">
                  <p>
                    Referral code: <strong>{account.code}</strong>
                  </p>
                  <label>
                    Share this link
                    <input aria-label="Referral link" readOnly value={link} />
                  </label>
                  <div className="row-actions">
                    <Button
                      secondary
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          setMessage("Referral link copied.");
                        } catch {
                          setMessage("Select the link above and copy it.");
                        }
                      }}
                    >
                      Copy referral link
                    </Button>
                    <Button
                      secondary
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(account.code);
                          setMessage("Referral code copied.");
                        } catch {
                          setMessage(`Your referral code is ${account.code}`);
                        }
                      }}
                    >
                      Copy code
                    </Button>
                  </div>
                  <p>
                    Current rate: {q.data.program.referral_percent}% · First
                    approved payment only. Payment is due within three working
                    days of approval. Renewals, trials and test payments do not
                    earn commission.
                  </p>
                </Panel>
              )}
              <Panel title={`${q.data.referrals.length} school signup(s)`}>
                <Table
                  rows={q.data.referrals}
                  columns={[
                    { label: "School", key: "name" },
                    { label: "Signed up", render: (r) => date(r.created_at) },
                    {
                      label: "Subscription",
                      render: (r) =>
                        r.subscribed
                          ? "Approved paid subscription"
                          : "No approved payment yet",
                    },
                  ]}
                />
              </Panel>
              <Panel title="Your commissions and transaction history">
                <Totals rows={q.data.commissions} />
                <CommissionHistory rows={q.data.commissions} />
              </Panel>
              {!account.closed_at && (
                <Panel title="Your profile and preferred bank account">
                  <Form
                    key={account.name + account.account_number}
                    initial={account}
                    fields={[
                      { name: "name", label: "Full name", wide: true },
                      ...bankFields,
                    ]}
                    submit="Save profile and bank account"
                    onSubmit={async (v) => {
                      setMessage(
                        (await patch("/referrals/account", v)).message,
                      );
                      q.reload();
                    }}
                  />
                  <h3>Sign-in details</h3>
                  <Form
                    initial={{ email: account.email }}
                    fields={[
                      {
                        name: "email",
                        label: "Email address",
                        type: "email",
                        wide: true,
                      },
                      {
                        name: "current_password",
                        label: "Current password",
                        type: "password",
                        wide: true,
                      },
                      {
                        name: "new_password",
                        label: "New password (optional)",
                        type: "password",
                        minLength: 12,
                        required: false,
                        wide: true,
                      },
                    ]}
                    submit="Update sign-in details"
                    onSubmit={async (v) => {
                      const { new_password, ...rest } = v;
                      const result = await patch(
                        "/referrals/account/credentials",
                        { ...rest, ...(new_password ? { new_password } : {}) },
                      );
                      setMessage(result.message);
                      setSession(null);
                      q.setData(null);
                      setCsrf("");
                    }}
                  />
                  <Button secondary onClick={() => setClosing(true)}>
                    Close referral account
                  </Button>
                </Panel>
              )}
            </>
          )}
        </>
      )}
      {closing && (
        <Modal
          title="Close your referral account"
          onClose={() => setClosing(false)}
        >
          <p>
            Your code will stop accepting signups and no further commissions
            will accrue. Existing earnings and payment history remain available.
          </p>
          <Form
            fields={[
              {
                name: "password",
                label: "Confirm your password",
                type: "password",
              },
            ]}
            submit="Close referral account"
            onSubmit={async (v) => {
              setMessage((await post("/referrals/account/close", v)).message);
              setClosing(false);
              q.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
