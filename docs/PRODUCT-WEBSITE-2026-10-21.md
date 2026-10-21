# Product website update

The primary project root now contains an expanded landing page, `/features` directory and 12 dedicated module guides under `/features/<module>`. The directory supports keyword search and filtering by school area. Module pages describe capabilities, intended users, a three-step workflow, setup requirements and related tools. The landing page highlights every module, with additional exam/report-card guidance, product screenshots and expanded FAQs.

## Maintaining the content

`server/product-catalog.js` is the public feature catalog shared by the React pages and server SEO renderer. Keep it free of credentials, private configuration and customer records. Update the catalog when capabilities change. Each module is linked from the landing page, directory and sitemap; the server supplies its title, description, canonical URL and crawlable text without waiting for JavaScript.

The `features` portal name is reserved to prevent public marketing pages from colliding with school portals. A read-only check found no existing school using this name before this change. No schema or data changes are required.

## Screenshot provenance and scope

Three existing, reviewed starter-guide screenshots were copied into `src/assets/product/`: admissions, parent finance and linked children. They show the guide's fictional Greenfield Academy and fictional family records. Captions identify the demonstration data. Screenshots are bundled as source assets and can be enlarged in a separate tab. They were not captured from a live customer session. No live school records were published or queried for marketing imagery.

The guides distinguish implemented capabilities from adjacent services: exam administration does not include computer-based testing; HR does not include payroll; student eligibility fields do not provide transport GPS or hostel allocation; Twilio configuration does not implement SMS delivery. Provider accounts, approved SMTP hosts, assigned roles and publication requirements are explained where relevant. Platform operator tools are identified as restricted to authorized operators.

## Verification

- Production build passed; existing large-bundle warning remains.
- All 18 SaaS and SEO regression tests passed (see `test-results/product-marketing-regression.log`).
- Browser verification passed for the landing page, all 12 guides, search, filters, empty results, screenshot loading, pricing links, missing-guide handling, and navigation/overflow at 1440px, 1024px, 768px, 390px and 320px. No JavaScript page errors were recorded.
- The browser harness serves built source through a local frontend-only Express server with fixture pricing. It never opens the application database or starts a worker.
- Run `npm run test:ui:marketing` to rebuild and repeat the browser check. Screenshots and results are retained under ignored `test-results/product-marketing/`.
- Source/history hygiene and whitespace checks passed.

Work remains local and uncommitted. No Git push, hosting deployment, schema migration, key change, or worker restart was performed for this website update. The user reports Vercel and Railway are running; this work does not establish their live deployment revision or health.
