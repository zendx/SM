import { productModules, featurePath } from "./product-catalog.js";

const homeDescription =
  "Manage admissions, attendance, school fees, academics and staff in one school management platform. Start a 30-day trial with no card required.";

const pages = {
  "/": {
    title: "School Management Software for Growing Schools | SMPIS",
    heading: "A calmer, smarter way to run your school.",
    description: homeDescription,
  },
  "/terms": {
    title: "Terms and Conditions | SMPIS",
    heading: "Terms and conditions",
    description:
      "Read the terms and conditions for using SMPIS school management services, including account responsibilities and acceptable use.",
  },
  "/privacy": {
    title: "Privacy Policy | SMPIS",
    heading: "Privacy policy",
    description:
      "Learn how SMPIS handles school records, account information and personal data, and how to contact your school about privacy.",
  },
  "/cookies": {
    title: "Cookie Policy | SMPIS",
    heading: "Cookies",
    description:
      "See which essential cookies SMPIS uses for secure sign-in and cookie preferences, what they store and how long they last.",
  },
};

pages["/features"] = {
  title: "School Management Features: Exams, Fees, HR & More | SMPIS",
  heading: "Know what your school can do with SMPIS.",
  description:
    "Explore 12 connected SMPIS modules: admissions, exams and report cards, curriculum, attendance, fees, family portals, HR, facilities, reports and more.",
};
for (const module of productModules) {
  pages[featurePath(module)] = {
    title: `${module.title} | SMPIS School Management`,
    heading: module.title,
    description: module.summary,
  };
}

export const publicSeoPaths = Object.freeze(Object.keys(pages));

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

export function siteOrigin(env = process.env) {
  const configured =
    env.APP_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (!configured && env.VERCEL)
    throw new Error(
      "Configure APP_URL with the public HTTPS site origin before building or serving the site.",
    );
  const url = new URL(configured || "http://127.0.0.1:3000");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (env.VERCEL && url.protocol !== "https:")
  )
    throw new Error(
      "APP_URL must be a public HTTP(S) site URL without credentials; Vercel requires HTTPS.",
    );
  return url.origin;
}

// Render at build time too: crawlers and the static hosting layer see these tags
// without waiting for React or authenticated API requests.
export function renderSeoHtml(html, pathname = "/", origin = siteOrigin()) {
  const requestedPath = pathname.replace(/\/$/, "") || "/";
  const route = requestedPath === "/index.html" ? "/" : requestedPath;
  const page = pages[route] || pages["/"];
  const isPublicPage = Boolean(pages[route]);
  const canonical = new URL(isPublicPage ? route : requestedPath, origin).href;
  const structuredData =
    route === "/" || !pages[route]
      ? {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "SMPIS",
          alternateName:
            "School Management, Performance and Intelligence System",
          url: canonical,
          description: homeDescription,
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web browser",
        }
      : {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: page.heading,
          url: canonical,
          description: page.description,
        };
  const metadata = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="SMPIS" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    ...(!isPublicPage
      ? ['<meta name="robots" content="noindex, follow" />']
      : []),
    ...(isPublicPage
      ? [
          `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, "\\u003c")}</script>`,
        ]
      : []),
  ].join("\n");
  const module = productModules.find((item) => featurePath(item) === route);
  const productContent = module
    ? `<h2>What you can do</h2><ul>${module.capabilities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>How it works</h2><ol>${module.steps.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol><h2>Good to know</h2><p>${escapeHtml(module.note)}</p><a href="/features">Explore all features</a>`
    : route === "/features"
      ? productModules
          .map(
            (item) =>
              `<section><h2><a href="${featurePath(item)}">${escapeHtml(item.title)}</a></h2><p>${escapeHtml(item.summary)}</p></section>`,
          )
          .join("")
      : "";
  const featureLinks = `<nav aria-label="Product features"><a href="/features">Explore all features</a>${productModules.map((item) => `<a href="${featurePath(item)}">${escapeHtml(item.title)}</a>`).join(" ")}</nav>`;
  const intro =
    route === "/"
      ? `<main class="public-application"><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.description)}</p><p><a href="/signup">Start your 30-day free trial</a></p>${featureLinks}<footer><a href="https://maidensail.com/startup/smpis" rel="dofollow"><img src="https://maidensail.com/badge/smpis.svg" alt="Featured on Maidensail" width="190" height="44" /></a></footer><noscript>Enable JavaScript to explore the SMPIS school management platform.</noscript></main>`
      : `<main class="public-application"><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.description)}</p>${productContent}<noscript>Enable JavaScript to view this page.</noscript></main>`;
  return html
    .replace(
      /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
      `<!-- seo:start -->\n${metadata}\n<!-- seo:end -->`,
    )
    .replace(
      /<!-- public-intro:start -->[\s\S]*?<!-- public-intro:end -->\r?\n/,
      `<!-- public-intro:start -->${intro}<!-- public-intro:end -->\n`,
    );
}
