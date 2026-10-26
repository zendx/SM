The public canonical origin is `https://www.smpis.digital`. The apex domain
redirects at the hosting edge, so it must never appear in sitemap entries,
canonical tags, Open Graph URLs or generated email links.

`server/seo.js` defines all 17 indexable public pages. Account, signup, owner,
marketer and school portal pages are intentionally excluded from the sitemap
and served with noindex metadata. Their authenticated navigation is required
application behavior.

Run `npm run build` to regenerate `dist/sitemap.xml` and `dist/robots.txt`.
Vercel builds generate these files in `public/`; the Express routes generate
them from the same source. These output directories are ignored by Git.

Run `npm run check:seo -- https://www.smpis.digital` after deployment. This
checks the deployed sitemap, robots.txt and every public page. Any redirect,
non-200 status, missing page, duplicate sitemap entry, incorrect canonical,
noindex or HTML meta refresh fails the check. Redirects are never followed.
An optional URL argument selects the server to test; expected canonical URLs
still come from PUBLIC_SITE_URL / APP_URL.

Audit on 2026-10-26: all 17 www public pages, robots.txt and sitemap.xml
returned HTTP 200 without redirects. All apex equivalents returned HTTP 308
to www. Existing Search Console "Page with redirect" records for the apex
are expected to remain excluded; submit the www sitemap and inspect the final
www URLs. Removing the apex redirect would create duplicate public hosts.

The fixes require deployment to affect production. Search Console reprocessing
is external to this repository and is not instantaneous.
