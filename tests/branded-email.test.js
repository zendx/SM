import assert from "node:assert/strict";
import { test as unitTest } from "node:test";
import { brandedEmail } from "../server/email-design.js";
import { emailTemplates, renderEmail } from "../server/email-templates.js";

unitTest(
  "all email templates deliver branded HTML, clickable actions and a plain-text fallback",
  async () => {
    const db = { query: async () => ({ rows: [] }) };
    for (const key of Object.keys(emailTemplates)) {
      const message = await renderEmail(db, key, {
        name: "Odira",
        title: "Your school update",
        body: "A useful update.",
        link: "https://smpis.test/login?verify=example&next=school",
      });
      assert.ok(message.subject);
      assert.ok(message.text);
      assert.match(message.html, /#143e35/);
      assert.match(message.html, /cid:smpis-brand/);
      assert.match(
        message.html,
        /href="https:\/\/smpis.test\/login\?verify=example&amp;next=school"/,
      );
      assert.equal(message.attachments[0].cid, "smpis-brand");
      assert.equal(
        message.attachments[0].content.subarray(1, 4).toString(),
        "PNG",
      );
    }
  },
);

unitTest(
  "email rendering preserves edited content safely and refuses unsafe action URLs",
  async () => {
    const db = {
      query: async () => ({
        rows: [{ subject: "Custom {{title}}", body: "{{body}}\n\n{{link}}" }],
      }),
    };
    const message = await renderEmail(db, "support_reply", {
      title: "Reply",
      body: '<script>alert("x")</script>',
      link: "javascript:alert(1)",
    });
    assert.equal(message.subject, "Custom Reply");
    assert.match(message.text, /<script>/);
    assert.doesNotMatch(message.html, /<script>|href="javascript:/);
    assert.match(message.html, /&lt;script&gt;/);
    const linked = brandedEmail({
      subject: "Welcome",
      text: "Open https://smpis.test/login?verify=example.",
      key: "verification",
    });
    assert.match(linked, /href="https:\/\/smpis.test\/login\?verify=example"/);
  },
);
