import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { insert, one } from "../server/db.js";
import { digest } from "../server/security.js";

test("school administrators edit boarding status only for their school", async (t) => {
  const db = await openTestDatabase();
  t.after(() => db.close());
  const app = await createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const school = await insert(db, "schools", { name: "Boarding school", short_code: "BRD" });
  const other = await insert(db, "schools", { name: "Other school", short_code: "OTHER" });
  for (const role of ["SUPER_ADMIN", "TEACHER"]) {
    const user = await insert(db, "users", {
      school_id: school.id, name: role, role, email: `${role}@boarding.test`, password_hash: "unused",
    });
    await insert(db, "sessions", {
      user_id: user.id, token_hash: digest(role), csrf: role, mfa_verified: true,
      expires_at: new Date(Date.now() + 60000),
    });
  }
  async function request(method, body, role = "SUPER_ADMIN") {
    return fetch(`${base}/config`, {
      method,
      headers: { Cookie: `smpis_session=${role}`, "x-csrf-token": role, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const initial = (await (await request("GET")).json()).data.school;
  assert.equal(initial.boarding_status, "DAY");
  for (const boarding_status of ["BOARDING", "MIXED", "DAY"]) {
    const response = await request("PATCH", { ...initial, boarding_status });
    assert.equal(response.status, 200, await response.text());
    assert.equal((await (await request("GET")).json()).data.school.boarding_status, boarding_status);
  }
  assert.equal((await request("PATCH", { ...initial, boarding_status: "INVALID" })).status, 422);
  assert.equal((await request("PATCH", { ...initial, boarding_status: "BOARDING" }, "TEACHER")).status, 403);
  await request("PATCH", { ...initial, boarding_status: "MIXED" });
  const { boarding_status, ...legacy } = initial;
  assert.equal((await request("PATCH", legacy)).status, 200);
  assert.equal((await one(db, "SELECT boarding_status FROM schools WHERE id=$1", [school.id])).boarding_status, "MIXED");
  assert.equal((await one(db, "SELECT boarding_status FROM schools WHERE id=$1", [other.id])).boarding_status, "DAY");
  assert.equal(initial.transportation_available, false);
  const year = await insert(db, "academic_years", { school_id: school.id, name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" });
  await insert(db, "terms", { school_id: school.id, academic_year_id: year.id, name: "First", start_date: "2026-01-01", end_date: "2026-12-31", is_current: true });
  const classroom = await insert(db, "classes", { school_id: school.id, academic_year_id: year.id, name: "Primary 1", capacity: 30 });
  const application = { first_name: "Bus", last_name: "Applicant", gender: "FEMALE", date_of_birth: "2018-01-01", guardian_name: "Parent", guardian_phone: "08012345678", applied_class_id: classroom.id, transportation_required: true };
  async function apply(publicForm, fields = application) {
    return fetch(base + (publicForm ? "/auth/public-admissions/BRD" : "/admissions/applications"), {
      method: "POST", headers: { Cookie: "smpis_session=SUPER_ADMIN", "x-csrf-token": "SUPER_ADMIN", "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
  }
  async function publicSettings() {
    const response = await fetch(base + "/auth/public-admissions/BRD");
    assert.equal(response.status, 200);
    return (await response.json()).data.school;
  }
  assert.equal((await publicSettings()).transportation_available, false);
  for (const publicForm of [false, true]) assert.equal((await apply(publicForm)).status, 422);
  assert.equal((await request("PATCH", { ...initial, transportation_available: true }, "TEACHER")).status, 403);
  assert.equal((await request("PATCH", { ...initial, transportation_available: "yes" })).status, 422);
  assert.equal((await request("PATCH", { ...initial, transportation_available: true })).status, 200);
  assert.equal((await publicSettings()).transportation_available, true);
  for (const publicForm of [false, true]) {
    const response = await apply(publicForm);
    assert.equal(response.status, 201, await response.text());
  }
  assert.equal((await one(db, "SELECT transportation_available FROM schools WHERE id=$1", [other.id])).transportation_available, false);
  assert.equal((await request("PATCH", { ...initial, transportation_available: false })).status, 200);
  for (const publicForm of [false, true]) {
    assert.equal((await apply(publicForm)).status, 422);
    const response = await apply(publicForm, { ...application, transportation_required: false });
    assert.equal(response.status, 201, await response.text());
  }

});
