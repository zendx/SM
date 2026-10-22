import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { ensureTeacherStaff } from "../server/teacher-staff.js";
import { insert, one } from "../server/db.js";

test("teacher profiles are backfilled without changing existing staff or creating duplicates", async () => {
  const db = await openTestDatabase();
  try {
    await createApp(db);
    const school = await insert(db, "schools", { name: "Auto School", short_code: "AUTO" });
    const other = await insert(db, "schools", { name: "Other School", short_code: "AUTOB" });
    async function user(name, role = "TEACHER", school_id = school.id) {
      return insert(db, "users", { school_id, name, role, email: `${name.replaceAll(" ", "")}@auto.test`, password_hash: "unchanged" });
    }
    const teacher = await user("Ada Obi Okeke");
    const linked = await user("Existing Teacher");
    const foreign = await user("Foreign Teacher", "TEACHER", other.id);
    const parent = await user("Parent", "PARENT");
    const original = await insert(db, "staff", { school_id: school.id, user_id: linked.id, staff_number: "ORIGINAL", first_name: "Existing", last_name: "Teacher", department: "Science", position: "Head", hire_date: "2020-01-01", status: "INACTIVE" });
    await Promise.all([ensureTeacherStaff(db, school.id), ensureTeacherStaff(db, school.id)]);
    const profile = await one(db, "SELECT * FROM staff WHERE user_id=$1", [teacher.id]);
    assert.equal(profile.first_name, "Ada");
    assert.equal(profile.last_name, "Obi Okeke");
    assert.equal((await one(db, "SELECT count(*)::int AS n FROM staff WHERE user_id=$1", [teacher.id])).n, 1);
    assert.deepEqual(await one(db, "SELECT * FROM staff WHERE id=$1", [original.id]), original);
    assert.ok(!await one(db, "SELECT id FROM staff WHERE user_id=$1", [foreign.id]));
    assert.ok(!await one(db, "SELECT id FROM staff WHERE user_id=$1", [parent.id]));
    // Application startup handles teachers who existed before this release.
    await createApp(db);
    assert.ok(await one(db, "SELECT id FROM staff WHERE user_id=$1", [foreign.id]));
    assert.equal((await one(db, "SELECT password_hash FROM users WHERE id=$1", [teacher.id])).password_hash, "unchanged");
  } finally { await db.close(); }
});
