import { BrandLogo } from "../brand-logo";
import { schoolManagementFaq } from "../../server/public-faq.js";
import React, { useState, useEffect } from "react";
import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  ChartNoAxesCombined,
  ArrowRight,
  Menu,
  X,
} from "lucide-react";
import { Form, Button } from "../components";
import { post } from "../api";
import { useData } from "../hooks";
import "../saas.css";
import { HeroShowcase, ProductSnapshots } from "./product-features";
import { productModules, featurePath } from "../../server/product-catalog.js";
import { BackToTop, PublicEnquiries, useViewportEntrance } from "../public-ui";
import "../public-design.css";

export const planPrice = (cycle, config = {}) => {
  const monthly = Number(
    config.monthly_price_cents ?? config.base_monthly_cents ?? 10000,
  );
  return cycle === "YEARLY"
    ? Number(
        config.yearly_price_cents ??
          config.base_yearly_cents ??
          Math.round(monthly * 12 * 0.85),
      )
    : monthly;
};
export const annualDiscount = (config = {}) =>
  Math.max(
    0,
    Math.round(
      (1 - planPrice("YEARLY", config) / (12 * planPrice("MONTHLY", config))) *
        100,
    ),
  );
export function subscriptionMoney(value, config = {}) {
  const currency = config.landing_currency || config.display_currency || "USD";
  const rate =
    currency === "NGN"
      ? Number(config.landing_usd_rate || config.display_usd_rate || 1)
      : 1;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format((Number(value || 0) / 100) * rate);
}
export const billingCycles = (config) => [
  {
    value: "MONTHLY",
    label: `Monthly — ${subscriptionMoney(planPrice("MONTHLY", config), config)}`,
  },
  {
    value: "YEARLY",
    label: `Yearly — ${subscriptionMoney(planPrice("YEARLY", config), config)} ${annualDiscount(config) > 0 ? `(save ${annualDiscount(config)}%)` : ""}`,
  },
];
export function registrationFields(
  plan = "FREE",
  cycle = "MONTHLY",
  config = {},
  publicSignup = true,
) {
  const year = new Date().getUTCFullYear();
  return [
    { name: "school_name", label: "School name", wide: true },
    {
      name: "referral_code",
      label: "Referral code (optional)",
      required: false,
      maxLength: 32,
      default: publicSignup
        ? new URLSearchParams(location.search).get("ref") || ""
        : "",
      hint: "If a marketer introduced you to SMPIS, enter their code.",
    },
    {
      name: "portal_slug",
      label: "School portal name",
      hint: "Your address: /your-school/. Lowercase letters, numbers and hyphens.",
      maxLength: 48,
      wide: true,
    },
    { name: "name", label: "Administrator name" },
    { name: "email", label: "Administrator email", type: "email" },
    {
      name: "phone_number",
      label: "Administrator phone number",
      type: "tel",
      hint: "Include country code, e.g. +2348012345678",
      wide: true,
    },
    {
      name: "password",
      label: "Administrator password",
      type: "password",
      minLength: 12,
      autoComplete: "new-password",
      wide: true,
    },
    {
      name: "confirm_password",
      label: "Confirm password",
      type: "password",
      autoComplete: "new-password",
      matches: "password",
      clientOnly: true,
      wide: true,
    },
    {
      name: "plan",
      label: "Plan",
      options: [
        { value: "FREE", label: "Free — 30-day trial" },
        { value: "PRO", label: "Pro" },
      ],
      default: plan,
    },
    {
      name: "billing_cycle",
      label: "Pro billing period",
      options: billingCycles(config),
      default: cycle,
    },
    {
      name: "currency_code",
      label: "School fee currency",
      default: "NGN",
      hint: "Currency for student fee invoices.",
    },
    { name: "timezone", label: "School timezone", default: "Africa/Lagos" },
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
      default: `${year}-01-01`,
    },
    {
      name: "end_date",
      label: "Year ends",
      type: "date",
      default: `${year}-12-31`,
    },
    ...(publicSignup
      ? [
          {
            name: "marketing_email_consent",
            label:
              "Email me promotional SMPIS newsletters, offers and product news (optional).",
            type: "checkbox",
            required: false,
            default: false,
            wide: true,
          },
          {
            name: "marketing_phone_consent",
            label:
              "Use my phone number for promotional SMPIS messages (optional).",
            type: "checkbox",
            required: false,
            default: false,
            wide: true,
            hint: "Email and phone choices are separate. You can change either choice in your SMPIS inbox. Account and security notifications still apply.",
          },
          {
            name: "privacy_accepted",
            label: (
              <>
                I confirm that I have read the{" "}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  privacy policy
                </a>
                .
              </>
            ),
            type: "checkbox",
            required: true,
            default: false,
            wide: true,
          },
        ]
      : []),
  ];
}
export function PublicBrand() {
  return (
    <a className="brand" href="/">
      <BrandLogo />
    </a>
  );
}
export function Signup() {
  const params = new URLSearchParams(location.search),
    q = useData("/saas/plans", null);
  const [registered, setRegistered] = useState(null);
  return (
    <div className="signup-shell">
      <header>
        <PublicBrand />
        <a href="/login">
          Already registered? Sign in <ArrowUpRight size={16} />
        </a>
      </header>
      <main className="signup-grid">
        <aside>
          <div className="eyebrow">YOUR SCHOOL’S NEXT CHAPTER</div>
          <h1>A connected school starts here.</h1>
          <p>
            Create your own SMPIS portal. Give your administrators, teachers and
            parents a clearer view of every school day.
          </p>
          <ul className="check-list">
            <li>
              <Check /> A separate portal for your school
            </li>
            <li>
              <Check /> Access based on each person’s role
            </li>
            <li>
              <Check /> Core school modules during the 30-day trial
            </li>
            <li>
              <Check />{" "}
              {q.data ? (
                <>
                  {subscriptionMoney(planPrice("MONTHLY", q.data), q.data)}
                  /month or{" "}
                  {subscriptionMoney(planPrice("YEARLY", q.data), q.data)}/year
                  for Pro
                </>
              ) : (
                "Pro pricing is shown after plan details load."
              )}
            </li>
          </ul>
          <div className="signup-note">
            <ShieldCheck />
            <p>
              Your trial ends after 30 days. No card is required and no
              automatic charge follows the trial. Pro access starts after
              payment is verified.
            </p>
          </div>
        </aside>
        <section className="signup-form">
          <h2>Create your school account</h2>
          <p>You will be your school’s administrator.</p>
          {registered ? (
            <div className="notice">
              {registered.message}{" "}
              <a href="/login">Sign in or resend verification</a>
            </div>
          ) : q.loading ? (
            <p role="status">Loading registration options…</p>
          ) : q.error ? (
            <p className="form-error">{q.error}</p>
          ) : q.data && !q.data.registration_open ? (
            <div className="notice">
              Registration opens when the SMPIS owner finishes setup.{" "}
              <a href="/owner">Owner setup</a>
            </div>
          ) : (
            <Form
              fields={registrationFields(
                params.get("plan") === "PRO" ? "PRO" : "FREE",
                params.get("cycle") === "YEARLY" ? "YEARLY" : "MONTHLY",
                q.data || {},
              )}
              submit="Create school portal"
              recaptcha="signup"
              onSubmit={async (v) => {
                const result = await post("/saas/register", v);
                setRegistered(result);
              }}
            >
              <p className="muted">
                By creating an account, you agree to the{" "}
                <a href="/terms">terms</a> and have read the{" "}
                <a href="/privacy">privacy policy</a>.
              </p>
            </Form>
          )}
        </section>
      </main>
    </div>
  );
}
export function Landing() {
  const entranceRef = useViewportEntrance();
  const [yearly, setYearly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const plans = useData("/saas/plans", null);
  const displayCurrency = plans.data?.display_currency;
  const displayRate =
    displayCurrency === "NGN" ? Number(plans.data?.display_usd_rate || 1) : 1;
  const displayPrice = (amount) =>
    !plans.data
      ? plans.error
        ? "Unavailable"
        : "Loading…"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: displayCurrency,
          maximumFractionDigits: 2,
          minimumFractionDigits: 0,
        }).format(amount * displayRate);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.querySelector(".sales-menu-toggle")?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  const proLink = `/signup?plan=PRO&cycle=${yearly ? "YEARLY" : "MONTHLY"}`;
  return (
    <div className="sales-page school-desk" ref={entranceRef}>
      <a className="public-skip" href="#public-main">
        Skip to content
      </a>
      <header className="sales-nav">
        <PublicBrand />
        <nav
          id="sales-navigation"
          className={menuOpen ? "open" : ""}
          aria-label="Main navigation"
          onClick={(event) => {
            if (event.target.closest("a")) setMenuOpen(false);
          }}
        >
          <a href="/features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQs</a>
          <a className="sales-menu-signin" href="/login">
            Sign in <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </nav>
        <div>
          <button
            className="icon-btn sales-menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="sales-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <a className="sales-signin" href="/login">
            Sign in
          </a>
          <a className="btn" href="/signup">
            Start free trial <ArrowUpRight size={16} />
          </a>
        </div>
      </header>
      <main id="public-main" tabIndex={-1}>
        <section
          className="sales-hero sales-hero--expanded"
          aria-labelledby="landing-title"
        >
          <div className="hero-copy">
            <div className="hero-tag">
              <span /> SMPIS / SCHOOL MANAGEMENT SOFTWARE
            </div>
            <h1 id="landing-title">
              Less chasing records.
              <br />
              <em>More time for your school.</em>
            </h1>
            <p>
              Keep admissions, attendance, fees and term reports in one school
              workspace. Give staff the records they need and parents a clearer
              view of their children’s school day.
            </p>
            <div className="hero-actions">
              <a className="btn" href="/signup">
                Start your 30-day free trial <ArrowUpRight size={18} />
              </a>
              <a className="sales-text-link" href="#features">
                See what your team can do <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-promises">
              <span>
                <Check /> No card required
              </span>
              <span>
                <Check /> Your own school portal
              </span>
              <span>
                <Check /> Core school modules
              </span>
            </div>
            <div className="hero-banner" aria-label="SMPIS highlight features">
              <span>Admissions</span>
              <span>Attendance</span>
              <span>Fee tracking</span>
              <span>Exams & report cards</span>
              <span>Staff records</span>
            </div>
          </div>
          <HeroShowcase />
        </section>
        <div className="sales-strip">
          <span>Built for the whole school community</span>
          <strong>School leaders</strong>
          <strong>Administrators</strong>
          <strong>Teachers</strong>
          <strong>Parents</strong>
        </div>
        <section id="features" className="sales-section">
          <div className="section-intro">
            <div className="eyebrow">THE TOOLS BEHIND THE SCHOOL DAY</div>
            <h2>
              From the first application
              <br />
              to the final term report.
            </h2>
            <p>
              Manage the records described below in a shared workspace, with
              access based on each person’s role.
            </p>
          </div>
          <div className="catalog-section-link">
            <a className="sales-text-link" href="/features">
              Browse the feature guide <ArrowRight size={18} />
            </a>
            <span>
              12 areas of school life, with guides to help you get started
            </span>
          </div>
          <div className="school-module-index">
            {productModules.map((module, index) => (
              <a href={featurePath(module)} key={module.slug}>
                <span className="module-index-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <span className="catalog-category">{module.category}</span>
                  <h3>{module.title}</h3>
                  <p>{module.summary}</p>
                </div>
                <ArrowUpRight size={20} aria-hidden="true" />
              </a>
            ))}
          </div>
          <div className="intelligence-band">
            <ChartNoAxesCombined size={42} />
            <div>
              <h3>See where your school needs attention.</h3>
              <p>
                See attendance, fee balances and academic progress together. Use
                reports and alerts to spot issues and plan your next steps.
              </p>
            </div>
            <a href="/signup">
              Bring your school into focus <ArrowUpRight size={18} />
            </a>
          </div>
        </section>
        <section className="sales-section product-spotlight">
          <div>
            <div className="eyebrow">FOR TEACHERS & SCHOOL LEADERS</div>
            <h2>
              Record assessments.
              <br />
              Publish term reports.
            </h2>
            <p>
              Set continuous assessment and exam weights, enter scores, review
              grades and comments, then publish PDF report cards to linked
              parents and students.
            </p>
            <a className="sales-text-link" href="/features/exams-report-cards">
              Explore exams & report cards <ArrowRight size={18} />
            </a>
          </div>
          <ol aria-label="Report-card workflow">
            <li>
              <span>01</span>
              <div>
                <strong>Plan & assess</strong>
                <p>
                  Choose subjects, assign teachers and set exam dates. Decide
                  how much each assessment counts towards the final grade.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Review & finalize</strong>
                <p>
                  Check that scores and comments are complete, then have the
                  principal review the reports before you finalize them.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Publish & share</strong>
                <p>
                  Publish the reports so parents and students can view them in
                  their accounts and download a PDF.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="sales-section">
          <div className="section-intro">
            <div className="eyebrow">SEE THE WORKSPACE</div>
            <h2>Built around real school tasks.</h2>
            <p>
              Example SMPIS screens with fictional school data. They illustrate
              workflows; layouts may differ from the current product.
            </p>
          </div>
          <ProductSnapshots />
          <div className="catalog-section-link">
            <a className="sales-text-link" href="/features">
              Find the tools for your team <ArrowRight size={18} />
            </a>
          </div>
        </section>
        <section id="how-it-works" className="sales-section sales-steps">
          <div className="section-intro">
            <div className="eyebrow">FROM SIGNUP TO SCHOOL DAY</div>
            <h2>
              Set up your school.
              <br />
              Bring your team on board.
            </h2>
          </div>
          <div className="steps-grid">
            {[
              [
                "01",
                "Create your school portal",
                "Choose your school’s unique address and register its first administrator.",
              ],
              [
                "02",
                "Make it your workspace",
                "Set up terms, classes and school accounts. Invite your team with the right permissions.",
              ],
              [
                "03",
                "Try the service, then choose a paid period.",
                "Try the core school modules for 30 days. Payment methods for Pro depend on operator configuration.",
              ],
            ].map(([n, title, copy]) => (
              <article key={n}>
                <span>{n}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="pricing" className="sales-section pricing-section">
          <div className="section-intro">
            <div className="eyebrow">SIMPLE PLANS. CLEAR PRICING.</div>
            <h2>
              Try SMPIS free for 30 days.
              <br />
              Choose a plan when you are ready.
            </h2>
            <p>All core modules. One subscription for your school.</p>
          </div>
          <div className="billing-toggle" aria-label="Pro billing period">
            <button
              className={!yearly ? "selected" : ""}
              onClick={() => setYearly(false)}
              aria-pressed={!yearly}
            >
              Monthly
            </button>
            <button
              className={yearly ? "selected" : ""}
              onClick={() => setYearly(true)}
              aria-pressed={yearly}
            >
              Yearly{" "}
              {plans.data && annualDiscount(plans.data) > 0 && (
                <span>Save {annualDiscount(plans.data || {})}%</span>
              )}
            </button>
          </div>
          <div className="pricing-grid">
            <article className="pricing-card">
              <div className="eyebrow">EXPLORE SMPIS</div>
              <h3>Free</h3>
              <p>Experience your school’s new workspace.</p>
              <div
                className={`plan-price ${displayCurrency === "NGN" ? "ngn-price" : ""}`}
              >
                {displayPrice(0)}
                <span>/ 30 days</span>
              </div>
              <p className="price-note">A 30-day trial. No card required.</p>
              <a className="btn secondary" href="/signup">
                Start free trial <ArrowUpRight size={17} />
              </a>
              <ul className="check-list">
                {[
                  "Your own school portal",
                  "All core school management modules",
                  "Administrator, staff and parent access",
                  "Dashboards, alerts and reporting",
                ].map((x) => (
                  <li key={x}>
                    <Check />
                    {x}
                  </li>
                ))}
              </ul>
              <small>
                Access pauses when the trial ends. Upgrade to keep using your
                portal.
              </small>
            </article>
            <article className="pricing-card pro-card">
              <span className="pro-label">
                FOR YOUR EVERYDAY SCHOOL OPERATIONS
              </span>
              <div className="eyebrow">KEEP YOUR SCHOOL CONNECTED</div>
              <h3>Pro</h3>
              <p>Continued access to the school modules.</p>
              <div
                className={`plan-price ${displayCurrency === "NGN" ? "ngn-price" : ""}`}
              >
                {displayPrice(
                  planPrice(yearly ? "YEARLY" : "MONTHLY", plans.data || {}) /
                    100,
                )}
                <span>/ {yearly ? "year" : "month"}</span>
              </div>
              <p className="price-note">
                {!plans.data
                  ? "Price details have not loaded."
                  : yearly
                    ? `Billed yearly — equivalent to ${displayPrice(planPrice("YEARLY", plans.data || {}) / 1200)}/month.`
                    : "Billed monthly. Yearly billing is also available."}
              </p>
              <p className="price-note">
                {plans.data
                  ? `Prices displayed in ${displayCurrency}.`
                  : "Current pricing is shown after plan details load."}
                {displayCurrency === "NGN" &&
                  " Your payment method confirms the final payable amount before checkout."}
              </p>
              <a className="btn" href={proLink}>
                Choose Pro <ArrowUpRight size={17} />
              </a>
              <ul className="check-list">
                {[
                  "Everything included in your trial",
                  "Continued access throughout your paid period",
                  "School records with role-based permissions",
                  "Configured bank transfer or card payment methods",
                ].map((x) => (
                  <li key={x}>
                    <Check />
                    {x}
                  </li>
                ))}
              </ul>
              <small>
                Renewal authorization is checked by default at card checkout.
                Renewal requires a verified live payment and reusable payment
                method. Uncheck to pay once, or turn renewal off in
                Subscription.
              </small>
            </article>
          </div>
        </section>
        <section id="faq" className="sales-section faq-section">
          <div className="section-intro">
            <div className="eyebrow">QUESTIONS BEFORE YOU REGISTER</div>
            <h2>Before your first school day.</h2>
          </div>
          <div className="faq-list">
            {[
              ...schoolManagementFaq,
              [
                "Can we manage exams and generate report cards?",
                "Yes. Set weighted assessments, record scores, manage exam timetables and generate term report cards. Review and finalize each batch before publishing it to linked parent and student accounts. Reports can be downloaded as PDFs. This is exam and results administration, not online test delivery.",
              ],
              [
                "Which school operations are included?",
                "Explore students and admissions, attendance, school fees and payments, exams and report cards, curriculum, family portals, recruitment and HR, complaints and discipline, satisfaction surveys, facilities and assets, dashboards, reporting and administration. Each module has a detailed guide linked from Features.",
              ],
              [
                "Do payment and email services need configuration?",
                "To collect school fees online, your administrator needs to connect a supported payment account. The provider sets available currencies and transaction fees. Account emails require the operator's email service to be configured; delivery depends on that provider. Paying your SMPIS subscription is separate from collecting fees from families.",
              ],
              [
                "What happens after the 30-day Free plan?",
                "Your school’s operational access pauses. Your administrator can still sign in to the billing screen and upgrade to Pro. The trial does not charge your card automatically.",
              ],
              [
                "Does my school get its own portal?",
                "Yes. Choose a unique portal name during signup, such as /greenfield-academy/. School records and user permissions are scoped to your school.",
              ],
              [
                "How does the yearly discount work?",
                plans.data
                  ? `Pro costs ${displayPrice(planPrice("MONTHLY", plans.data) / 100)} per month or ${displayPrice(planPrice("YEARLY", plans.data) / 100)} upfront for a full year.`
                  : "Current prices have not loaded. Checkout shows the final amount before payment.",
              ],
              [
                "Will my card renew my subscription automatically?",
                "Yes. Card renewal authorization is checked by default. Leave it checked to renew monthly or yearly, matching your selected billing period, at the amount and currency shown at checkout. Uncheck it to pay once. Renewal starts only after a successful verified live payment with a reusable card authorization. You can turn it off in Subscription; a payment already submitted may still complete. Bank transfers do not enable automatic renewal.",
              ],
              [
                "Can I pay by bank transfer?",
                "Yes. Your billing screen displays the SMPIS owner’s bank details when configured. Submit your transfer reference, then the owner verifies receipt before activating Pro. Card payments are verified through the configured payment provider.",
              ],
              [
                "Can staff and parents use SMPIS?",
                "Yes. Your school administrator creates school accounts and assigns roles. Teachers work with assigned classes; parents access their linked children’s records.",
              ],
              [
                "What happens if a renewal is late?",
                "Operational access is suspended after the paid period and any configured grace period. Verified payment restores subscriptions suspended for expiry. Contact the owner about a manual suspension or termination.",
              ],
            ].map(([title, copy]) => (
              <details key={title}>
                <summary>
                  {title}
                  <span>+</span>
                </summary>
                <p>{copy}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="sales-cta">
          <div className="eyebrow">CREATE A SCHOOL WORKSPACE</div>
          <h2>Set up your school portal.</h2>
          <p>
            Start a 30-day trial and configure your school's records and
            accounts.
          </p>
          <a className="btn" href="/signup">
            Create your school portal <ArrowUpRight size={18} />
          </a>
          <PublicEnquiries />
        </section>
      </main>
      <BackToTop />
    </div>
  );
}
