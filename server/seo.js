const homeDescription =
  "Manage student records, attendance, admissions, school fees, academic performance and staff operations with SMPIS, the school management and intelligence system.";

const pages = {
  "/": {
    title: "SMPIS | School Management and Intelligence System",
    heading: "School Management, Performance and Intelligence System",
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
  const route = pathname.replace(/\/$/, "") || "/";
  const page = pages[route] || pages["/"];
  const canonical = new URL(pages[route] ? route : "/", origin).href;
  const structuredData =
    route === "/" || !pages[route]
      ? {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "SMPIS",
          alternateName: pages["/"].heading,
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
    `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
  return html
    .replace(
      /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
      `<!-- seo:start -->\n${metadata}\n<!-- seo:end -->`,
    )
    .replace(
      /<!-- public-intro:start -->[\s\S]*?<!-- public-intro:end -->/,
      `<!-- public-intro:start --><main class="public-application"><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.description)}</p><p>Sign in to access your school workspace.</p><noscript>Enable JavaScript to sign in and use SMPIS.</noscript></main><!-- public-intro:end -->`,
    );
}
