import assert from "node:assert/strict";
import { test } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { insert, one, rows } from "../server/db.js";
import { ensureSchoolStaff } from "../server/teacher-staff.js";

test("school workforce accounts share one staff identity and exclude parents, students and platform staff", async () => {
  const f = await accountFixture();
  try {
    const users = {};
    for (const role of [
      "TEACHER",
      "HR_OFFICER",
      "PRINCIPAL",
      "FINANCE_OFFICER",
      "PARENT",
      "STUDENT",
    ]) {
      users[role] = await insert(f.db, "users", {
        school_id: f.school.id,
        name: `${role} Person`,
        email: `${role}@staff.test`,
        password_hash: "unchanged",
        role,
      });
    }
    const platform = await insert(f.db, "users", {
      school_id: f.school.id,
      name: "Platform staff",
      email: "platform@staff.test",
      password_hash: "unchanged",
      role: "HR_OFFICER",
    });
    await insert(f.db, "platform_staff", {
      user_id: platform.id,
      scope: "TECHNICAL",
      created_by: f.users.owner.id,
    });
    await ensureSchoolStaff(f.db, f.school.id);
    const original = await rows(
      f.db,
      "SELECT * FROM staff WHERE school_id=$1 ORDER BY id",
      [f.school.id],
    );
    assert.equal(original.length, 4);
    for (const role of [
      "TEACHER",
      "HR_OFFICER",
      "PRINCIPAL",
      "FINANCE_OFFICER",
    ])
      assert.ok(original.some((staff) => staff.user_id === users[role].id));
    await ensureSchoolStaff(f.db, f.school.id);
    assert.deepEqual(
      await rows(f.db, "SELECT * FROM staff WHERE school_id=$1 ORDER BY id", [
        f.school.id,
      ]),
      original,
    );
  } finally {
    await f.db.close();
  }
});

test("shared account creation gives staff an activation account and directory profile while parents remain separate", async () => {
  const f = await accountFixture();
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: f.users.tenant.email,
        password: f.password,
      }),
    });
    const session = (await login.json()).data;
    const headers = {
      "content-type": "application/json",
      cookie: login.headers.get("set-cookie").split(";")[0],
      "x-csrf-token": session.csrf,
    };
    for (const role of ["HR_OFFICER", "TEACHER", "PARENT"]) {
      const response = await fetch(base + "/users", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `${role} Account`,
          email: `${role}@shared.test`,
          role,
        }),
      });
      const result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      const account = await one(f.db, "SELECT * FROM users WHERE id=$1", [
        result.data.id,
      ]);
      assert.equal(account.activation_pending, true);
      assert.equal(account.email_verified, false);
      const staff = await one(f.db, "SELECT * FROM staff WHERE user_id=$1", [
        account.id,
      ]);
      assert.equal(Boolean(staff), role !== "PARENT");
      if (staff) assert.equal(staff.school_id, f.school.id);
    }
    const directory = await fetch(base + "/hr/staff", { headers });
    assert.equal(directory.status, 200);
    assert.equal((await directory.json()).data.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await f.db.close();
  }
});
