import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { insert } from "../server/db.js";
import { renderEmail } from "../server/email-templates.js";
import { emailLogo } from "../server/email-design.js";
import { createBrevoTransport } from "../server/brevo-transport.js";

test("school email branding is tenant-specific and both public logos return image bytes", async () => {
  const db = await openTestDatabase();
  const old = process.env.APP_URL;
  process.env.APP_URL = "https://smpis.test";
  let server;
  try {
    const logo = await emailLogo();
    const school = await insert(db, "schools", {
      name: "School <One>",
      short_code: "BRANDONE",
      portal_slug: "brand-one",
      logo_data: `data:image/png;base64,${logo.content.toString("base64")}`,
    });
    const other = await insert(db, "schools", {
      name: "School Two",
      short_code: "BRANDTWO",
      portal_slug: "brand-two",
    });
    const values = {
      title: "Fees",
      body: "Your invoice is ready.",
      link: "https://smpis.test/brand-one/",
    };
    const message = await renderEmail(db, "school_notification", {
      ...values,
      school_id: school.id,
    });
    assert.match(message.html, /School &lt;One&gt;/);
    assert.match(message.html, /cid:school-brand/);
    assert.match(message.text, /^School <One>/);
    assert.equal(message.attachments.length, 2);
    const second = await renderEmail(db, "school_notification", {
      ...values,
      school_id: other.id,
    });
    assert.match(second.html, /School Two/);
    assert.ok(!second.html.includes("cid:school-brand"));
    assert.ok(!second.html.includes("School &lt;One&gt;"));
    const platform = await renderEmail(db, "notification", values);
    assert.equal(platform.attachments.length, 1);
    let payload;
    await nodemailer
      .createTransport(
        createBrevoTransport("fixture", {
          request: async (_, options) => {
            payload = JSON.parse(options.body);
            return {
              ok: true,
              status: 201,
              json: async () => ({ messageId: "fixture" }),
            };
          },
        }),
      )
      .sendMail({
        from: "SMPIS <sender@example.test>",
        to: "parent@example.test",
        ...message,
      });
    assert.match(payload.htmlContent, /https:\/\/smpis.test\/email-logo.png/);
    assert.match(
      payload.htmlContent,
      /https:\/\/smpis.test\/email-school-logo\/brand-one/,
    );
    assert.ok(!payload.htmlContent.includes("cid:"));
    const app = await createApp(db);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ["/email-logo.png", "/email-school-logo/brand-one"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^image\/png/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), logo.content);
    }
    assert.equal(
      (await fetch(base + "/email-school-logo/brand-two")).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/email-school-logo/unknown")).status,
      404,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (old === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = old;
    await db.close();
  }
});
