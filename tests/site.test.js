import { openTestDatabase } from "./database.js";
import { test } from "./database.js";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { insert } from "../server/db.js";
import { createApp } from "../server/app.js";
import { digest } from "../server/security.js";

test("public legal settings and administrator-only configuration respects tenant boundaries", async () => {
  process.env.REQUIRE_MFA = "false";
  const db = await openTestDatabase();
  const dataDir = path.resolve("test-results", "site-" + randomUUID());
  const app = await createApp(db, { dataDir, backendControl: true });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function client(school, role, name) {
    const u = await insert(db, "users", {
      school_id: school.id,
      name,
      email: name + "@test.school",
      password_hash: "unused",
      role,
    });
    await insert(db, "sessions", {
      user_id: u.id,
      token_hash: digest(name),
      csrf: name,
      mfa_verified: true,
      expires_at: new Date(Date.now() + 60000),
    });
    return async (url, body, csrf = name) => {
      const r = await fetch(base + url, {
        method: body ? "PATCH" : "GET",
        headers: {
          Cookie: "smpis_session=" + name,
          "x-csrf-token": csrf,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
  }
  try {
    const school = await insert(db, "schools", {
      name: "Policy school",
      short_code: "POL",
    });
    const admin = await client(school, "SUPER_ADMIN", "admin");
    const teacher = await client(school, "TEACHER", "teacher");
    assert.equal((await fetch(base + "/legal/config")).status, 200);
    const legal = {
      organization: "School Operator Ltd",
      privacy_email: "privacy@test.school",
    };
    assert.equal((await teacher("/admin/legal", legal)).status, 403);
    assert.equal((await admin("/admin/legal", legal, "bad")).status, 403);
    assert.equal((await admin("/admin/legal", legal)).status, 200);
    const published = (await (await fetch(base + "/legal/config")).json()).data;
    assert.equal(published.organization, legal.organization);
    assert.equal(published.contact, legal.privacy_email);
    assert.equal((await admin("/admin/database")).status, 404);
    await insert(db, "schools", { name: "Other school", short_code: "OTH" });
    assert.equal((await admin("/admin/legal", legal)).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
  }
});
