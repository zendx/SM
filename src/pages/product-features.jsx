import React, { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  CalendarCheck,
  ChartNoAxesCombined,
  Check,
  GraduationCap,
  Menu,
  MessageSquare,
  Search,
  ShieldCheck,
  Users,
  X,
  Wallet,
} from "lucide-react";
import { BrandLogo } from "../brand-logo";
import { WhatsAppHelp } from "./whatsapp-help";
import { productModules, featurePath } from "../../server/product-catalog.js";
import admissionsImage from "../assets/product/admissions.png";
import financeImage from "../assets/product/finance.png";
import familiesImage from "../assets/product/families.png";
import "../saas.css";

const icons = {
  Users,
  BookOpen,
  Building2,
  CalendarCheck,
  ChartNoAxesCombined,
  GraduationCap,
  MessageSquare,
  ShieldCheck,
  Wallet,
};
const screenshots = {
  admissions: {
    src: admissionsImage,
    alt: "SMPIS admissions pipeline showing a fictional Greenfield Academy application",
    caption:
      "Admissions: see applications, stages and the next action in one place.",
  },
  finance: {
    src: financeImage,
    alt: "SMPIS parent finance screen showing a fictional student's invoice and outstanding balance",
    caption:
      "Parent finance: invoices, balances and available payment methods.",
  },
  families: {
    src: familiesImage,
    alt: "SMPIS parent portal showing a linked fictional child at Greenfield Academy",
    caption: "Family portal: parents see the children linked to their account.",
  },
};

export function FeatureCards({ modules = productModules }) {
  return (
    <div className="feature-grid catalog-grid">
      {modules.map((module, i) => {
        const Icon = icons[module.icon];
        return (
          <article key={module.slug}>
            <span className={`feature-icon tone-${i % 3}`}>
              <Icon size={24} aria-hidden="true" />
            </span>
            <span className="catalog-category">{module.category}</span>
            <h3>
              <a href={featurePath(module)}>{module.title}</a>
            </h3>
            <p>{module.summary}</p>
            <ul className="catalog-highlights">
              {module.capabilities.slice(0, 3).map((item) => (
                <li key={item}>
                  <Check size={15} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <a className="sales-text-link" href={featurePath(module)}>
              Explore {module.title.toLowerCase()}{" "}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </article>
        );
      })}
    </div>
  );
}

export function ProductSnapshots({ single }) {
  const images = single ? [single] : ["admissions", "finance", "families"];
  return (
    <div className={single ? "product-snapshots single" : "product-snapshots"}>
      {images.map((key) => {
        const image = screenshots[key];
        return (
          <figure key={key}>
            <a
              href={image.src}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Enlarge ${key} demo screenshot (opens in a new tab)`}
            >
              <img
                src={image.src}
                alt={image.alt}
                width="1440"
                height="1000"
                loading="lazy"
              />
            </a>
            <figcaption>
              {image.caption}
              <span>
                Actual product screen with fictional starter-guide data. Click
                to enlarge.
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function ProductHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sales-nav">
      <a className="brand" href="/" aria-label="SMPIS home">
        <BrandLogo />
      </a>
      <nav
        id="product-navigation"
        className={open ? "open" : ""}
        aria-label="Main navigation"
        onClick={() => setOpen(false)}
      >
        <a
          href="/features"
          aria-current={
            location.pathname.replace(/\/$/, "") === "/features"
              ? "page"
              : undefined
          }
        >
          All features
        </a>
        <a href="/#how-it-works">How it works</a>
        <a href="/#pricing">Pricing</a>
        <a href="/#faq">FAQs</a>
      </nav>
      <div>
        <button
          className="icon-btn sales-menu-toggle"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="product-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <a className="sales-signin" href="/login">
          Sign in
        </a>
        <a className="btn" href="/signup">
          Start free <ArrowUpRight size={16} />
        </a>
      </div>
    </header>
  );
}

function ProductFooter() {
  return (
    <>
      <section className="sales-cta">
        <div className="eyebrow">SEE HOW IT FITS YOUR SCHOOL</div>
        <h2>One workspace. Your whole school.</h2>
        <p>Explore the modules with your team during your 30-day free trial.</p>
        <a className="btn" href="/signup">
          Start your free trial <ArrowUpRight size={18} />
        </a>
        <a className="product-pricing-link" href="/#pricing">
          Review plans and pricing
        </a>
      </section>
      <footer className="sales-footer">
        <a className="brand" href="/" aria-label="SMPIS home">
          <BrandLogo />
        </a>
        <p>
          School Management, Performance
          <br />& Intelligence System
        </p>
        <a href="/features">Explore all features</a>
        <a href="/#pricing">Plans & pricing</a>
      </footer>
    </>
  );
}

function Directory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All features");
  const categories = [
    "All features",
    ...new Set(productModules.map((m) => m.category)),
  ];
  const matches = productModules.filter(
    (m) =>
      (category === "All features" || m.category === category) &&
      [m.title, m.summary, ...m.capabilities, ...m.audience]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <section className="sales-section catalog-hero">
        <a className="sales-text-link" href="/">
          Home <ArrowRight size={15} /> Product
        </a>
        <div className="eyebrow">THE SMPIS PRODUCT GUIDE</div>
        <h1>
          Know what your school
          <br />
          can do with SMPIS.
        </h1>
        <p>
          From the first application to the final report card, explore the tools
          your team can use every day. Choose an area below to see what you
          can do, how it works and what you need to set up first.
        </p>
        <div className="hero-actions">
          <a className="btn" href="/signup">
            Start your 30-day free trial <ArrowUpRight size={18} />
          </a>
          <a className="sales-text-link" href="#screens">
            See the product screens <ArrowRight size={17} />
          </a>
        </div>
      </section>
      <section
        className="sales-section catalog-directory"
        aria-labelledby="directory-title"
      >
        <div className="catalog-toolbar">
          <div>
            <div className="eyebrow">EXPLORE THE WORKSPACE</div>
            <h2 id="directory-title">Every part of your school, connected.</h2>
          </div>
          <label className="catalog-search">
            <Search size={18} aria-hidden="true" />
            <span className="catalog-sr-only">Search product features</span>
            <input
              type="search"
              placeholder="Try report cards, leave or invoices"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div
          className="catalog-filters"
          role="group"
          aria-label="Filter features by area"
        >
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="catalog-count" role="status">
          {matches.length} of {productModules.length} modules shown
        </p>
        <FeatureCards modules={matches} />
        {!matches.length && (
          <div className="catalog-empty">
            <h3>No matching features</h3>
            <p>Try a broader term or choose another area.</p>
            <button
              className="btn secondary"
              onClick={() => {
                setQuery("");
                setCategory("All features");
              }}
            >
              Show all features
            </button>
          </div>
        )}
      </section>
      <section id="screens" className="sales-section">
        <div className="section-intro">
          <div className="eyebrow">A LOOK INSIDE</div>
          <h2>Real screens. Familiar school tasks.</h2>
          <p>
            These examples come from the fictional Greenfield Academy starter
            guide. Your records and available actions depend on your role and
            school setup.
          </p>
        </div>
        <ProductSnapshots />
      </section>
      <section className="sales-section product-fit">
        <div>
          <div className="eyebrow">CHOOSE WITH A CLEAR PICTURE</div>
          <h2>
            Included tools.
            <br />
            Clear expectations.
          </h2>
          <p>
            All core school modules are available in the trial and Pro
            workspace. What each person can access depends on their role,
            assignments and linked student records.
          </p>
        </div>
        <div>
          <h3>Before your team gets started</h3>
          <ul>
            <li>Set up academic years, terms, classes and staff roles.</li>
            <li>
              Configure payment providers and email where you need them;
              external accounts and charges may apply.
            </li>
            <li>Publish reports before families can see results.</li>
            <li>
              Review each module's setup notes and the current plans before
              subscribing.
            </li>
          </ul>
          <a className="sales-text-link" href="/#pricing">
            Compare trial and Pro <ArrowRight size={16} />
          </a>
        </div>
      </section>
    </>
  );
}

function ModuleDetail({ module }) {
  const Icon = icons[module.icon];
  return (
    <>
      <section className="sales-section catalog-hero module-hero">
        <nav className="product-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a>
          <span>/</span>
          <a href="/features">Features</a>
          <span>/</span>
          <span aria-current="page">{module.title}</span>
        </nav>
        <div className="eyebrow">{module.category}</div>
        <span className="feature-icon tone-0">
          <Icon size={30} aria-hidden="true" />
        </span>
        <h1>{module.title}</h1>
        <p>{module.summary}</p>
        <div className="product-audiences">
          {module.audience.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
        <div className="hero-actions">
          <a className="btn" href="/signup">
            Try it with your school <ArrowUpRight size={18} />
          </a>
          <a className="sales-text-link" href="/#pricing">
            See plans <ArrowRight size={17} />
          </a>
        </div>
      </section>
      <section className="sales-section module-content">
        <div>
          <div className="eyebrow">WHAT YOU CAN DO</div>
          <h2>{module.outcome}</h2>
          <ul className="module-capabilities">
            {module.capabilities.map((item) => (
              <li key={item}>
                <Check size={20} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <aside className="module-workflow">
          <div className="eyebrow">HOW IT WORKS</div>
          <h2>A practical starting point.</h2>
          <ol>
            {module.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="module-note">
            <h3>Good to know</h3>
            <p>{module.note}</p>
          </div>
        </aside>
      </section>
      {module.screenshot && (
        <section className="sales-section">
          <div className="section-intro">
            <div className="eyebrow">INSIDE THE PRODUCT</div>
            <h2>See the workspace.</h2>
          </div>
          <ProductSnapshots single={module.screenshot} />
        </section>
      )}
      <section className="sales-section">
        <div className="section-intro">
          <div className="eyebrow">BETTER TOGETHER</div>
          <h2>Connected to the rest of your school.</h2>
        </div>
        <FeatureCards
          modules={module.related.map((slug) =>
            productModules.find((m) => m.slug === slug),
          )}
        />
      </section>
    </>
  );
}

export function ProductFeatures() {
  const slug = location.pathname.replace(/\/$/, "").split("/")[2];
  const module = productModules.find((m) => m.slug === slug);
  const notFound = Boolean(
    (slug && !module) ||
    location.pathname.replace(/\/$/, "").split("/").length > 3,
  );
  return (
    <div className="sales-page product-pages">
      <ProductHeader />
      <main>
        {notFound ? (
          <section className="sales-section catalog-hero">
            <h1>Feature guide not found</h1>
            <p>Browse the product directory to find the module you need.</p>
            <a className="btn" href="/features">
              Explore all features
            </a>
          </section>
        ) : module ? (
          <ModuleDetail module={module} />
        ) : (
          <Directory />
        )}
      </main>
      <ProductFooter />
      <WhatsAppHelp />
    </div>
  );
}
