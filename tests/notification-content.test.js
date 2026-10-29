import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const browser = new JSDOM("", {
  url: "https://school.test/greenfield/#notifications",
});
globalThis.window = browser.window;
globalThis.DOMParser = browser.window.DOMParser;
globalThis.location = browser.window.location;
const { notificationHtml, notificationPreview, notificationLink } =
  await import("../src/notification-content.js");

test("notification previews contain at most 250 characters including the ellipsis", () => {
  for (const body of [
    "a".repeat(251),
    "🌱".repeat(251),
    `<p>${"Long update ".repeat(100)}</p>`,
  ]) {
    const preview = notificationPreview(body);
    assert.equal(Array.from(preview).length, 250);
    assert.ok(preview.endsWith("…"));
    assert.ok(!preview.includes("<p>"));
  }
  assert.equal(notificationPreview("a".repeat(250)), "a".repeat(250));
  assert.equal(
    notificationPreview("<p>Hello &amp; welcome</p><p>School update</p>"),
    "Hello & welcome School update",
  );
});

test("notification reader preserves formatting and strips active HTML", () => {
  const safe = notificationHtml(
    '<h2>Meeting</h2><p><strong>Friday</strong></p><ul><li>Bring a pen</li></ul><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)" onclick="alert(1)">Unsafe link</a><div style="position:fixed" id="workspace">Text</div><iframe src="https://evil.test"></iframe>',
  );
  assert.ok(safe.includes("<strong>Friday</strong>"));
  assert.ok(safe.includes("<ul><li>Bring a pen</li></ul>"));
  assert.doesNotMatch(
    safe,
    /script|onerror|onclick|javascript:|<img|iframe|style=|id=/i,
  );
  assert.equal(
    notificationHtml("Hello\nSchool & families"),
    "<p>Hello<br>School &amp; families</p>",
  );
});

test("related activities only allow links within the current application", () => {
  assert.equal(
    notificationLink("#messages/12"),
    "https://school.test/greenfield/#messages/12",
  );
  assert.equal(
    notificationLink("/owner#issues"),
    "https://school.test/owner#issues",
  );
  for (const link of [
    "javascript:alert(1)",
    "https://evil.test",
    "//evil.test",
    "data:text/html,test",
    "",
  ])
    assert.equal(notificationLink(link), null);
});
