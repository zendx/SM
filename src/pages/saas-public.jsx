import React, { useState, useEffect, useRef } from "react";
import {
  GraduationCap,
  ArrowUpRight,
  Check,
  ShieldCheck,
  Users,
  CalendarCheck,
  Wallet,
  BookOpen,
  ChartNoAxesCombined,
  Building2,
  MessageSquare,
  ArrowRight,
  Menu,
  X,
} from "lucide-react";
import { Form, Button } from "../components";
import { post } from "../api";
import { useData } from "../hooks";
import "../saas.css";
import { WhatsAppHelp } from "./whatsapp-help";

export const planPrice = (cycle, config = {}) => {
  const monthly = Number(
    config.monthly_price_cents ?? config.base_monthly_cents ?? 10000,
  );
  return cycle === "YEARLY" ? Math.round(monthly * 12 * 0.85) : monthly;
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
) {
  const year = new Date().getUTCFullYear();
  return [
    { name: "school_name", label: "School name", wide: true },
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
  ];
}
export function PublicBrand() {
  return (
    <a className="brand" href="/">
      <span className="brand-mark">
        <GraduationCap />
      </span>
      <span>
        SMPIS<small>SCHOOL INTELLIGENCE</small>
      </span>
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
              <Check /> All modules in your 30-day trial
            </li>
            <li>
              <Check />{" "}
              {subscriptionMoney(
                planPrice("MONTHLY", q.data || {}),
                q.data || {},
              )}
              /month or{" "}
              {subscriptionMoney(
                planPrice("YEARLY", q.data || {}),
                q.data || {},
              )}
              /year for Pro
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
const features = [
  [
    Users,
    "Students & admissions",
    "From the first application to enrolment, keep student profiles, guardians and documents together.",
  ],
  [
    CalendarCheck,
    "Attendance that tells a story",
    "Record student and staff attendance. Spot repeated absences and follow up with confidence.",
  ],
  [
    Wallet,
    "A clearer view of school fees",
    "Manage invoices, receipts, instalments, outstanding balances and collection reports.",
  ],
  [
    BookOpen,
    "Academics & curriculum",
    "Manage assessments, report cards and curriculum coverage. See where learners need support.",
  ],
  [
    MessageSquare,
    "Parents & school experience",
    "Give parents access to their children’s information, complaints and school communication.",
  ],
  [
    Building2,
    "People, facilities & assets",
    "Bring staff records, leave, performance, maintenance and your asset register into one place.",
  ],
];
export function Landing() {
  const [yearly, setYearly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const plans = useData("/saas/plans", null);
  const displayCurrency = plans.data?.display_currency || "USD";
  const displayRate =
    displayCurrency === "NGN" ? Number(plans.data?.display_usd_rate || 1) : 1;
  const displayPrice = (amount) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: displayCurrency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(amount * displayRate);
  const page = useRef(null);
  useEffect(() => {
    const root = page.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer;
    const reveal = () => {
      observer?.disconnect();
      root.classList.remove("motion-ready");
      if (preference.matches || !window.IntersectionObserver) return;
      const items = root.querySelectorAll(
        ".hero-copy,.product-preview,.sales-strip,.section-intro,.feature-grid article,.intelligence-band,.steps-grid article,.pricing-card,.faq-list details,.sales-cta",
      );
      items.forEach((item, index) => {
        item.classList.add("reveal-item");
        item.style.setProperty("--reveal-delay", `${(index % 3) * 70}ms`);
      });
      root.classList.add("motion-ready");
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          }),
        { threshold: 0.12, rootMargin: "0px 0px -24px 0px" },
      );
      items.forEach((item) => observer.observe(item));
    };
    reveal();
    preference.addEventListener("change", reveal);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", reveal);
    };
  }, []);
  const movePreview = (event) => {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--tilt-x",
      `${(0.5 - (event.clientY - box.top) / box.height) * 4}deg`,
    );
    event.currentTarget.style.setProperty(
      "--tilt-y",
      `${((event.clientX - box.left) / box.width - 0.5) * 4}deg`,
    );
  };
  const proLink = `/signup?plan=PRO&cycle=${yearly ? "YEARLY" : "MONTHLY"}`;
  return (
    <div className="sales-page" ref={page}>
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
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQs</a>
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
            Start free <ArrowUpRight size={16} />
          </a>
        </div>
      </header>
      <main>
        <section className="sales-hero">
          <div className="hero-copy">
            <div className="hero-tag">
              <span /> ONE SCHOOL. ONE CONNECTED WORKSPACE.
            </div>
            <h1>
              Less paperwork.
              <br />
              More <em>possibility.</em>
            </h1>
            <p>
              Meet SMPIS — the School Management, Performance and Intelligence
              System. Bring your students, people, finances and academic
              performance together, so your school can move forward.
            </p>
            <div className="hero-actions">
              <a className="btn" href="/signup">
                Start your 30-day free trial <ArrowUpRight size={18} />
              </a>
              <a className="sales-text-link" href="#features">
                Explore SMPIS <ArrowRight size={17} />
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
                <Check /> All modules included
              </span>
            </div>
          </div>
          <div
            className="product-preview"
            onPointerMove={movePreview}
            onPointerLeave={(event) => {
              event.currentTarget.style.setProperty("--tilt-x", "0deg");
              event.currentTarget.style.setProperty("--tilt-y", "0deg");
            }}
            aria-label="Illustrative school dashboard"
          >
            <div className="preview-top">
              <span>
                <GraduationCap size={18} /> SMPIS
              </span>
              <span>
                School overview <span className="preview-dot" />
              </span>
            </div>
            <div className="preview-body">
              <div className="preview-heading">
                <div>
                  <small>EVERY SCHOOL DAY, IN FOCUS</small>
                  <h2>Your school, at a glance.</h2>
                </div>
                <span className="preview-pill">Dashboard preview</span>
              </div>
              <div className="preview-metrics">
                <div>
                  <Users size={18} />
                  <small>Students enrolled</small>
                  <strong>1,248</strong>
                  <span>Connected student records</span>
                </div>
                <div>
                  <CalendarCheck size={18} />
                  <small>Attendance</small>
                  <strong>
                    96.4<small>%</small>
                  </strong>
                  <span>Daily visibility</span>
                </div>
              </div>
              <div className="preview-chart">
                <div>
                  <strong>Academic performance</strong>
                  <span>Illustrative data</span>
                </div>
                <div className="chart-bars">
                  {[48, 63, 54, 72, 67, 83, 77, 90].map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }}>
                      <i />
                    </span>
                  ))}
                </div>
                <div className="chart-labels">
                  <span>Term 1</span>
                  <span>Term 2</span>
                  <span>Term 3</span>
                </div>
              </div>
              <div className="preview-alert">
                <ShieldCheck size={22} />
                <div>
                  <strong>See what needs your attention</strong>
                  <small>
                    Attendance, fees, academics and school operations.
                  </small>
                </div>
                <ArrowUpRight size={18} />
              </div>
            </div>
            <div className="preview-caption">
              Illustration only. Your dashboard reflects your school’s records.
            </div>
          </div>
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
            <div className="eyebrow">A SCHOOL DAY, THOUGHTFULLY CONNECTED</div>
            <h2>
              Everything you manage.
              <br />A clearer way to manage it.
            </h2>
            <p>
              Replace disconnected registers and spreadsheets with a shared
              workspace, tailored to each person’s role.
            </p>
          </div>
          <div className="feature-grid">
            {features.map(([Icon, title, copy], i) => (
              <article key={title}>
                <span className={`feature-icon tone-${i % 3}`}>
                  <Icon size={24} />
                </span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
          <div className="intelligence-band">
            <ChartNoAxesCombined size={42} />
            <div>
              <h3>Go beyond records. See the bigger picture.</h3>
              <p>
                Executive dashboards, reports and management alerts help you
                monitor school performance and decide where to act.
              </p>
            </div>
            <a href="/signup">
              Bring your school into focus <ArrowUpRight size={18} />
            </a>
          </div>
        </section>
        <section id="how-it-works" className="sales-section sales-steps">
          <div className="section-intro">
            <div className="eyebrow">FROM SIGNUP TO SCHOOL DAY</div>
            <h2>
              Your portal. Your people.
              <br />
              Ready for your next chapter.
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
                "Start free. Grow with Pro.",
                "Explore every module for 30 days. Upgrade by bank transfer or card when you are ready.",
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
              Start with a school day.
              <br />
              Build a better school year.
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
              {annualDiscount(plans.data || {}) > 0 && (
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
              <p>A complete workspace for your school.</p>
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
                {yearly
                  ? `Billed yearly — equivalent to ${displayPrice(planPrice("YEARLY", plans.data || {}) / 1200)}/month.`
                  : "Billed monthly. Yearly billing is also available."}
              </p>
              <p className="price-note">
                Prices displayed in {displayCurrency}.
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
                  "Secure school records and role permissions",
                  "Bank transfer or verified card checkout",
                ].map((x) => (
                  <li key={x}>
                    <Check />
                    {x}
                  </li>
                ))}
              </ul>
              <small>
                Card checkout covers one billing period; renew when due.
              </small>
            </article>
          </div>
        </section>
        <section id="faq" className="sales-section faq-section">
          <div className="section-intro">
            <div className="eyebrow">A FEW THINGS YOU MAY BE WONDERING</div>
            <h2>Before your first school day.</h2>
          </div>
          <div className="faq-list">
            {[
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
                `Pro costs ${displayPrice(planPrice("MONTHLY", plans.data || {}) / 100)} per month or ${displayPrice(planPrice("YEARLY", plans.data || {}) / 100)} upfront for a full year.`,
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
          <div className="eyebrow">MAKE ROOM FOR WHAT MATTERS</div>
          <h2>
            Your next school day
            <br />
            could look different.
          </h2>
          <p>Bring clarity to the everyday. Start your SMPIS portal today.</p>
          <a className="btn" href="/signup">
            Get started free <ArrowUpRight size={18} />
          </a>
        </section>
      </main>
      <footer className="sales-footer">
        <PublicBrand />
        <p>
          School Management, Performance
          <br />& Intelligence System
        </p>
        <span>Clarity for every school day.</span>
      </footer>
      <WhatsAppHelp />
    </div>
  );
}
