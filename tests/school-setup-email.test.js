import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../server/email-templates.js";
import { schoolSetupSteps } from "../server/school-setup-guide.js";
import { portalGuide } from "../server/onboarding-emails.js";

for (const key of ["onboarding_welcome", "onboarding_tour"]) {
  for (const saved of [false, true]) {
    test(`${key} includes the current setup workflow with ${saved ? "saved" : "default"} content`, async () => {
      const db = {
        query: async () => ({
          rows: saved
            ? [
                {
                  subject: "School welcome",
                  body: "Our custom introduction. {{link}}",
                },
              ]
            : [],
        }),
      };
      const message = await renderEmail(db, key, {
        name: "School Administrator",
        school_name: "Example School",
        guide: portalGuide,
        link: "https://smpis.test/example-school/",
        security_link:
          "https://smpis.test/example-school/?security=mfa#administration",
      });
      assert.equal(message.text.split(schoolSetupSteps).length - 1, 1);
      assert.ok(
        message.text.indexOf("1. Admissions") <
          message.text.indexOf("2. Academics"),
      );
      assert.ok(
        message.text.indexOf("2. Academics") <
          message.text.indexOf("3. Finance"),
      );
      for (const phrase of [
        "Administration > School",
        "admissions officers",
        "Schedule exam",
        "Grade / enter scores",
        "Generate drafts",
        "Finalize results",
        "Publish reports",
        "Confirm bank receipt",
        "Enroll > Enroll student",
      ]) {
        assert.ok(message.text.includes(phrase), phrase);
      }
      assert.match(message.html, /Your school setup steps/);
      assert.doesNotMatch(message.text, /{{\s*\w+\s*}}/);
      if (saved) assert.match(message.text, /Our custom introduction/);
    });
  }
}
