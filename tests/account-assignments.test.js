import { test, before, after } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { insert, one, rows } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import assert from "node:assert/strict";

let f,
  server,
  base,
  classes = [],
  children = [],
  foreignClass,
  foreignChild;
const clients = {};
async function login(user) {
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: f.password }),
  });
  const result = await res.json();
  assert.equal(res.status, 200, JSON.stringify(result));
  return {
    ...result.data,
    cookie: res.headers.get("set-cookie").split(";")[0],
  };
}
async function call(
  path,
  { who = "tenant", method = "GET", body, status = 200 } = {},
) {
  const c = clients[who];
  const res = await fetch(base + path, {
    method,
    headers: {
      cookie: c.cookie,
      "x-csrf-token": c.csrf,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await res.json();
  assert.equal(res.status, status, JSON.stringify(result));
  return result.data;
}
const create = (role, email, extra = {}, status = 201) =>
  call("/users", {
    method: "POST",
    body: { name: `New ${role}`, email, role, ...extra },
    status,
  });
async function child(school, number) {
  return insert(f.db, "students", {
    school_id: school.id,
    student_number: number,
    first_name: number,
    last_name: "Test",
    gender: "OTHER",
    date_of_birth: "2016-01-01",
    guardian_name: "Guardian",
    guardian_phone: "08000000000",
    status: "ENROLLED",
  });
}
before(async () => {
  f = await accountFixture();
  server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  clients.tenant = await login(f.users.tenant);
  clients.other = await login(f.users.other);
  const year = await one(
    f.db,
    "SELECT id FROM academic_years WHERE school_id=$1",
    [f.school.id],
  );
  for (let i = 0; i < 7; i++)
    classes.push(
      await insert(f.db, "classes", {
        school_id: f.school.id,
        academic_year_id: year.id,
        name: `Class ${i + 1}`,
        capacity: 30,
      }),
    );
  for (let i = 0; i < 7; i++)
    children.push(await child(f.school, `Child ${i + 1}`));
  await f.db.query("UPDATE students SET class_id=$1 WHERE id=$2", [
    classes[0].id,
    children[0].id,
  ]);
  const fy = await insert(f.db, "academic_years", {
    school_id: f.otherSchool.id,
    name: "Foreign year",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  });
  foreignClass = await insert(f.db, "classes", {
    school_id: f.otherSchool.id,
    academic_year_id: fy.id,
    name: "Foreign class",
    capacity: 30,
  });
  foreignChild = await child(f.otherSchool, "Foreign child");
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (f) await f.db.close();
});

test("teacher and parent creation accepts omitted and empty assignments", async () => {
  for (const [role, extra] of [
    ["TEACHER", {}],
    ["PARENT", {}],
    ["TEACHER", { class_ids: [] }],
    ["PARENT", { student_ids: [] }],
  ]) {
    const account = await create(
      role,
      `${role}-${Object.keys(extra).length}@optional.test`,
      extra,
    );
    const table = role === "TEACHER" ? "classes" : "students",
      column = role === "TEACHER" ? "teacher_user_id" : "parent_user_id";
    assert.equal(
      (
        await rows(f.db, `SELECT id FROM ${table} WHERE ${column}=$1`, [
          account.id,
        ])
      ).length,
      0,
    );
    if (role === "TEACHER")
      assert.ok(
        await one(f.db, "SELECT id FROM staff WHERE user_id=$1", [account.id]),
      );
  }
});
test("account creation assigns multiple classes or children atomically and preserves access scope", async () => {
  for (const role of ["TEACHER", "PARENT"]) {
    const list = role === "TEACHER" ? classes : children,
      field = role === "TEACHER" ? "class_ids" : "student_ids";
    const account = await create(role, `${role}@multiple.test`, {
      [field]: [list[0].id, list[1].id, list[0].id],
    });
    const options = await call(
      `/users/assignment-options?role=${role}&account_id=${account.id}`,
    );
    assert.deepEqual(
      options.selected_ids.sort((a, b) => a - b),
      [list[0].id, list[1].id].sort((a, b) => a - b),
    );
    assert.equal(
      options.options.some((o) => o.label.includes("Foreign")),
      false,
    );
    await f.db.query(
      "UPDATE users SET password_hash=$2,activation_pending=false,email_verified=true WHERE id=$1",
      [account.id, hashPassword(f.password)],
    );
    clients[role] = await login(account);
    const visible = await call(role === "TEACHER" ? "/classes" : "/students", {
      who: role,
    });
    assert.deepEqual(
      visible.map((c) => c.id).sort((a, b) => a - b),
      [list[0].id, list[1].id].sort((a, b) => a - b),
    );
    const audits = await rows(
      f.db,
      "SELECT id FROM audit_logs WHERE action=$1 AND entity_id=ANY($2::int[])",
      [
        role === "TEACHER" ? "TEACHER_ASSIGNED" : "PARENT_LINKED",
        [list[0].id, list[1].id],
      ],
    );
    assert.equal(audits.length, 2);
  }
  const teacher = await one(
    f.db,
    "SELECT id FROM users WHERE email='teacher@multiple.test'",
  );
  assert.ok(
    (await call("/messages/contacts", { who: "PARENT" })).some(
      (c) => c.recipient_id === teacher.id,
    ),
  );
});
test("foreign, wrong-role and occupied selections roll back the new account and every link", async () => {
  const cases = [
    ["TEACHER", { class_ids: [classes[2].id, foreignClass.id] }, 422],
    ["PARENT", { student_ids: [children[2].id, foreignChild.id] }, 422],
    ["PARENT", { class_ids: [classes[2].id] }, 422],
    ["TEACHER", { student_ids: [children[2].id] }, 422],
    ["TEACHER", { class_ids: [classes[2].id, classes[0].id] }, 409],
    ["PARENT", { student_ids: [children[2].id, children[0].id] }, 409],
  ];
  for (const [index, [role, extra, status]] of cases.entries()) {
    const email = `invalid-${index}@assignment.test`;
    await create(role, email, extra, status);
    assert.equal(
      await one(f.db, "SELECT id FROM users WHERE email=$1", [email]),
      undefined,
    );
  }
  assert.equal(
    (
      await one(f.db, "SELECT teacher_user_id FROM classes WHERE id=$1", [
        classes[2].id,
      ])
    ).teacher_user_id,
    null,
  );
  assert.equal(
    (
      await one(f.db, "SELECT parent_user_id FROM students WHERE id=$1", [
        children[2].id,
      ])
    ).parent_user_id,
    null,
  );
});
test("tenants can add, replace and clear their accounts' multiple assignments later", async () => {
  for (const role of ["TEACHER", "PARENT"]) {
    const account = await one(f.db, "SELECT id FROM users WHERE email=$1", [
      `${role.toLowerCase()}@multiple.test`,
    ]);
    const list = role === "TEACHER" ? classes : children,
      field = role === "TEACHER" ? "class_ids" : "student_ids";
    await call(`/users/${account.id}/assignments`, {
      method: "PATCH",
      body: { [field]: [list[1].id, list[2].id] },
    });
    const options = await call(
      `/users/assignment-options?role=${role}&account_id=${account.id}`,
    );
    assert.deepEqual(
      options.selected_ids.sort((a, b) => a - b),
      [list[1].id, list[2].id].sort((a, b) => a - b),
    );
    await call(`/users/${account.id}/assignments`, {
      who: "other",
      method: "PATCH",
      body: { [field]: [] },
      status: 404,
    });
    await call(
      `/users/assignment-options?role=${role}&account_id=${account.id}`,
      { who: "other", status: 404 },
    );
    await call(`/users/${account.id}/assignments`, {
      who: role,
      method: "PATCH",
      body: { [field]: [] },
      status: 403,
    });
    await call(`/users/assignment-options?role=${role}`, {
      who: role,
      status: 403,
    });
    await call(`/users/${account.id}/assignments`, {
      method: "PATCH",
      body: { [field]: [] },
    });
    assert.equal(
      (
        await call(
          `/users/assignment-options?role=${role}&account_id=${account.id}`,
        )
      ).selected_ids.length,
      0,
    );
  }
});
test("later assignment conflicts preserve all current links; concurrent creates cannot overwrite each other", async () => {
  const a = await create("TEACHER", "owner-a@conflict.test", {
    class_ids: [classes[3].id],
  });
  const b = await create("TEACHER", "owner-b@conflict.test", {
    class_ids: [classes[4].id],
  });
  await call(`/users/${a.id}/assignments`, {
    method: "PATCH",
    body: { class_ids: [classes[4].id] },
    status: 409,
  });
  assert.equal(
    (
      await one(f.db, "SELECT teacher_user_id FROM classes WHERE id=$1", [
        classes[3].id,
      ])
    ).teacher_user_id,
    a.id,
  );
  assert.equal(
    (
      await one(f.db, "SELECT teacher_user_id FROM classes WHERE id=$1", [
        classes[4].id,
      ])
    ).teacher_user_id,
    b.id,
  );
  const results = await Promise.all(
    ["one", "two"].map(async (name) => {
      const c = clients.tenant;
      const res = await fetch(base + "/users", {
        method: "POST",
        headers: {
          cookie: c.cookie,
          "x-csrf-token": c.csrf,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          email: `race-${name}@assignment.test`,
          role: "TEACHER",
          class_ids: [classes[5].id],
        }),
      });
      return res.status;
    }),
  );
  assert.deepEqual(results.sort(), [201, 409]);
});
