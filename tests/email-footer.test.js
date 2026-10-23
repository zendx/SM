import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalEmailLinks, emailOrigin } from "../server/email-urls.js";
import { renderEmail } from "../server/email-templates.js";

test("retired email domains preserve activation tokens and leave third-party links intact", () => {
  assert.equal(
    canonicalEmailLinks(
      "https://smpis.vercel.app/login?reset=abc%2Bdef&next=school#start",
    ),
    "https://smpis.digital/login?reset=abc%2Bdef&next=school#start",
  );
  assert.equal(
    canonicalEmailLinks(
      "Visit https://www.smpis.digital/school-one/ and https://external.test/pay?id=5",
    ),
    "Visit https://smpis.digital/school-one/ and https://external.test/pay?id=5",
  );
  assert.equal(
    canonicalEmailLinks("https://smpis.vercel.app.evil.test/login"),
    "https://smpis.vercel.app.evil.test/login",
  );
});

test("queued and edited email content uses canonical links and safely personalized footers", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://smpis.vercel.app";
  try {
    const db = {
      query: async (sql) => ({
        rows: sql.includes("FROM users")
          ? [{ name: "Henry <Owner>" }]
          : [
              {
                subject: "Update",
                body: "Visit https://smpis.vercel.app/school-one/\n\n{{body}}\n\n{{link}}",
              },
            ],
      }),
    };
    assert.equal(emailOrigin(), "https://smpis.digital");
    const message = await renderEmail(db, "notification", {
      recipient_id: 7,
      body: "Read https://smpis.vercel.app/login?verify=a%2Bb&next=one",
      link: "https://smpis.vercel.app/school-one/#notifications",
    });
    assert.doesNotMatch(message.html, /smpis\.vercel\.app/);
    assert.doesNotMatch(message.text, /smpis\.vercel\.app/);
    assert.match(message.html, /This email was sent to Henry &lt;Owner&gt;\./);
    assert.match(message.text, /This email was sent to Henry <Owner>\./);
    assert.match(message.html, /href="https:\/\/smpis.digital\/privacy"/);
    assert.match(message.html, /href="mailto:info@smpis.digital"/);
    assert.match(message.text, /verify=a%2Bb&next=one/);
    const promo = await renderEmail(
      { query: async () => ({ rows: [] }) },
      "promotional_newsletter",
      {
        name: "Parent",
        title: "News",
        body: "News",
        link: "https://smpis.vercel.app/",
        unsubscribe_link:
          "https://smpis.vercel.app/login?unsubscribe=7.signature",
      },
    );
    assert.equal(
      promo.headers["List-Unsubscribe"],
      "<https://smpis.digital/login?unsubscribe=7.signature>",
    );
    assert.match(promo.html, /opted in to SMPIS promotional updates/);
    assert.match(promo.text, /This email was sent to Parent/);
    assert.match(promo.text, /unsubscribe=7.signature/);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
