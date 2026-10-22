import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert } from "../server/db.js";
import { digest, localClock } from "../server/security.js";

const db = await openTestDatabase();
let server, browser;
try {
  const app = await createApp(db);
  const school = await insert(db, "schools", { name: "Notification Academy", short_code: "GLOW", portal_slug: "notification-academy" });
  serveFrontend(app, path.resolve("dist"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const role of ["PLATFORM_OWNER", "SUPER_ADMIN", "TEACHER", "PARENT"]) {
    const user = await insert(db, "users", { school_id: role === "PLATFORM_OWNER" ? null : school.id, name: role, email: `${role}@glow.test`, role, password_hash: "unused" });
    if (role === "PLATFORM_OWNER") await insert(db, "platform_operators", { user_id: user.id });
    if (role === "TEACHER") {
      const staff = await insert(db, "staff", { school_id: school.id, user_id: user.id, staff_number: "STF-GLOW", first_name: "Teacher", last_name: "Test", department: "Teaching", position: "Teacher", hire_date: "2026-01-01" });
      await insert(db, "staff_attendance", { school_id: school.id, staff_id: staff.id, attendance_date: localClock("Africa/Lagos").date, status: "PRESENT", check_in_time: new Date() });
    }
    const token = `glow-${role}`;
    await insert(db, "sessions", { user_id: user.id, token_hash: digest(token), csrf: token, mfa_verified: true, expires_at: new Date(Date.now() + 300000) });
    async function notice(suffix) {
      await insert(db, "platform_notifications", { user_id: user.id, school_id: user.school_id, email: user.email, title: "Unread update", body: "A message for your attention", link: "/", dedupe_key: `${token}-${suffix}`, created_at: new Date(Date.now() - 86400000) });
    }
    await notice("first");
    if (role === "PLATFORM_OWNER") await db.query(`INSERT INTO platform_notifications(user_id,email,title,body,link,dedupe_key,read_at)
      SELECT $1,$2,'Read update','Already read','/','old-read-'||n,now() FROM generate_series(1,100) n`, [user.id, user.email]);
    const context = await browser.newContext();
    await context.addCookies([{ name: "smpis_session", value: token, url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + (role === "PLATFORM_OWNER" ? "/owner#inbox" : "/notification-academy/#notifications"));
    const bell = page.getByRole("button", { name: "Notifications (1 unread)", exact: true });
    await bell.waitFor();
    assert.ok(await bell.evaluate(element => element.classList.contains("has-unread")), role);
    assert.equal(await bell.locator(".notification-count").textContent(), "1");
    const animated = await bell.evaluate(element => ({ animation: getComputedStyle(element).animationName, background: getComputedStyle(element).backgroundImage }));
    assert.equal(animated.animation, "notification-glow");
    assert.ok(animated.background.includes("linear-gradient"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await bell.evaluate(element => getComputedStyle(element).animationName), "none");
    assert.notEqual(await bell.evaluate(element => getComputedStyle(element).boxShadow), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await notice("second");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Notifications (2 unread)", exact: true }).waitFor();
    await page.getByRole("button", { name: "Mark all as read", exact: true }).click();
    const readBell = page.locator("button.notification-button[aria-label=\"Notifications\"]");
    await readBell.waitFor();
    assert.equal(await readBell.locator(".notification-count").count(), 0);
    assert.equal(await readBell.evaluate(element => element.classList.contains("has-unread")), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Unread red/orange glow, focus refresh, read clearing and reduced motion pass for owner, tenant, teacher and parent.");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}
