import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { insert } from "../server/db.js";
import { hashPassword } from "../server/security.js";

export async function accountFixture() {
  const db = await openTestDatabase();
  const app = await createApp(db);
  const password = "Account-profile-browser-2026!";
  const school = await insert(db, "schools", {
    name: "Greenfield Academy",
    short_code: "PROFILE",
    portal_slug: "greenfield",
  });
  const otherSchool = await insert(db, "schools", {
    name: "Other School",
    short_code: "OTHERPROFILE",
    portal_slug: "other-school",
  });
  const users = {};
  for (const [key, name, role, schoolId] of [
    ["owner", "Platform Owner", "PLATFORM_OWNER", null],
    ["tenant", "Grace Adeyemi", "SUPER_ADMIN", school.id],
    ["other", "Other Administrator", "SUPER_ADMIN", otherSchool.id],
  ]) {
    users[key] = await insert(db, "users", {
      school_id: schoolId,
      name,
      email: `${key}@profile.test`,
      role,
      password_hash: hashPassword(password),
      email_verified: true,
      phone_number: key === "tenant" ? "+2348012345678" : "",
    });
  }
  await insert(db, "platform_operators", { user_id: users.owner.id });
  const year = await insert(db, "academic_years", {
    school_id: school.id,
    name: "2026/27",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  });
  await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "First term",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    is_current: true,
  });
  return { db, app, password, school, otherSchool, users };
}
