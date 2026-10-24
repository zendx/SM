import { initializeSchema } from "../server/schema.js";
import { test, before, after } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { one, insert } from "../server/db.js";
import { ROLE_PERMISSIONS, hashPassword } from "../server/security.js";
import assert from "node:assert/strict";
let f,
  server,
  base,
  clients = {};
async function login(user) {
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: f.password }),
  });
  return {
    status: r.status,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    ...(await r.json()),
  };
}
async function request(
  path,
  { client = clients.tenant, method = "GET", body } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: client.cookie,
      "x-csrf-token": client.csrf,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, ...(await r.json()) };
}
before(async () => {
  f = await accountFixture();
  server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const key of ["tenant", "owner", "other"]) {
    const r = await login(f.users[key]);
    assert.equal(r.status, 200);
    clients[key] = { ...r.data, cookie: r.cookie };
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (f) await f.db.close();
});
test("every school role supports editing, suspension, restoration and deletion with owner retention", async () => {
  const hash = hashPassword(f.password);
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    const user = await insert(f.db, "users", {
      school_id: f.school.id,
      name: `Original ${role}`,
      email: `${role.toLowerCase()}@allroles.test`,
      password_hash: hash,
      role,
      email_verified: true,
    });
    const path = `/users/${user.id}`;
    let r = await request(path, {
      method: "PATCH",
      body: {
        name: `Updated ${role}`,
        phone_number: "+2348021234567",
        address: "12 School Road, Lagos",
        role,
      },
    });
    assert.equal(r.status, 200, role + JSON.stringify(r));
    const updated = await one(
      f.db,
      "SELECT name,email,phone_number,address FROM users WHERE id=$1",
      [user.id],
    );
    assert.equal(updated.name, `Updated ${role}`);
    assert.equal(updated.email, user.email);
    assert.equal(updated.address, "12 School Road, Lagos");
    const session = await login(user);
    assert.equal(session.status, 200, role + JSON.stringify(session));
    r = await request(path, {
      method: "PATCH",
      body: { status: "SUSPENDED", reason: "Access review" },
    });
    assert.equal(r.status, 200, role + JSON.stringify(r));
    assert.equal((await login(user)).status, 401);
    assert.equal(
      (
        await request("/me", {
          client: { ...session.data, cookie: session.cookie },
        })
      ).status,
      401,
    );
    r = await request(path, {
      method: "PATCH",
      body: { status: "ACTIVE", reason: "Review complete" },
    });
    assert.equal(r.status, 200, role + JSON.stringify(r));
    assert.equal((await login(user)).status, 200);
    r = await request(path, {
      method: "DELETE",
      body: { reason: "Account no longer needed" },
    });
    assert.equal(r.status, 200, role + JSON.stringify(r));
    assert.equal((await login(user)).status, 401);
    assert.ok(!(await request("/users")).data.some((u) => u.id === user.id));
    const archive = await request(
      `/saas/owner/users/${user.id}/retained-record`,
      { client: clients.owner },
    );
    assert.equal(archive.status, 200, role + JSON.stringify(archive));
    assert.equal(archive.data.user.role, role);
    assert.equal(archive.data.user.name, `Updated ${role}`);
    assert.equal(
      (await request(path, { method: "PATCH", body: { status: "ACTIVE" } }))
        .status,
      404,
    );
  }
});
test("school account editing cannot change email, cross school boundaries, elevate to platform owner or change the signed-in administrator", async () => {
  const user = await insert(f.db, "users", {
    school_id: f.school.id,
    name: "Finance Officer",
    email: "finance-safety@allroles.test",
    password_hash: hashPassword(f.password),
    role: "FINANCE_OFFICER",
    email_verified: true,
  });
  for (const body of [
    { email: "replacement@allroles.test" },
    { school_id: f.otherSchool.id },
    { role: "PLATFORM_OWNER" },
    { name: "   " },
    { phone_number: "invalid" },
    { address: "a".repeat(501) },
  ])
    assert.equal(
      (await request(`/users/${user.id}`, { method: "PATCH", body })).status,
      422,
    );
  assert.equal(
    (
      await request(`/users/${user.id}`, {
        client: clients.other,
        method: "PATCH",
        body: { name: "Unauthorized" },
      })
    ).status,
    404,
  );
  for (const body of [{ status: "SUSPENDED" }, { role: "PARENT" }])
    assert.equal(
      (await request(`/users/${f.users.tenant.id}`, { method: "PATCH", body }))
        .status,
      422,
    );
  assert.equal(
    (
      await request(`/users/${f.users.tenant.id}`, {
        method: "DELETE",
        body: { reason: "Not permitted" },
      })
    ).status,
    422,
  );
  const row = await one(f.db, "SELECT email FROM users WHERE id=$1", [user.id]);
  assert.equal(row.email, user.email);
});
test("parent removal snapshots linked students without deleting their school records", async () => {
  const parent = await insert(f.db, "users", {
    school_id: f.school.id,
    name: "Retained Parent",
    email: "parent-links@allroles.test",
    password_hash: hashPassword(f.password),
    role: "PARENT",
    email_verified: true,
  });
  const child = await insert(f.db, "students", {
    school_id: f.school.id,
    first_name: "Amara",
    last_name: "Okafor",
    gender: "FEMALE",
    date_of_birth: "2017-01-01",
    guardian_name: parent.name,
    guardian_phone: "08012345678",
    parent_user_id: parent.id,
    status: "ENROLLED",
  });
  assert.equal(
    (
      await request(`/users/${parent.id}`, {
        method: "DELETE",
        body: { reason: "No longer needs portal access" },
      })
    ).status,
    200,
  );
  const retained = await request(
    `/saas/owner/users/${parent.id}/retained-record`,
    { client: clients.owner },
  );
  assert.equal(retained.data.linked_students[0].id, child.id);
  assert.equal(
    (
      await one(f.db, "SELECT parent_user_id FROM students WHERE id=$1", [
        child.id,
      ])
    ).parent_user_id,
    parent.id,
  );
});
test("school-managed platform identities remain protected", async () => {
  const protectedUser = await insert(f.db, "users", {
    school_id: f.school.id,
    name: "Protected operator",
    email: "protected@allroles.test",
    password_hash: hashPassword(f.password),
    role: "SUPER_ADMIN",
    email_verified: true,
  });
  await insert(f.db, "platform_operators", { user_id: protectedUser.id });
  assert.ok(
    !(await request("/users")).data.some((u) => u.id === protectedUser.id),
  );
  assert.equal(
    (
      await request(`/users/${protectedUser.id}`, {
        method: "PATCH",
        body: { status: "SUSPENDED" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/users/${protectedUser.id}`, {
        method: "DELETE",
        body: { reason: "Not permitted" },
      })
    ).status,
    403,
  );
});

test("concurrent administrator changes cannot suspend both remaining school administrators", async () => {
  const admin = await insert(f.db, "users", {
    school_id: f.school.id,
    name: "Second administrator",
    email: "second-admin@allroles.test",
    password_hash: hashPassword(f.password),
    role: "SUPER_ADMIN",
    email_verified: true,
  });
  const session = await login(admin);
  assert.equal(session.status, 200);
  const results = await Promise.all([
    request(`/users/${admin.id}`, {
      method: "PATCH",
      body: { status: "SUSPENDED" },
    }),
    request(`/users/${f.users.tenant.id}`, {
      client: { ...session.data, cookie: session.cookie },
      method: "PATCH",
      body: { status: "SUSPENDED" },
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.some((r) => [401, 422].includes(r.status)));
  const { count } = await one(
    f.db,
    "SELECT count(*)::int AS count FROM users WHERE school_id=$1 AND role='SUPER_ADMIN' AND status='ACTIVE' AND archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=users.id)",
    [f.school.id],
  );
  assert.equal(count, 1);
});
test("legacy teacher archives migrate to account retention without changing saved records", async () => {
  const teacher = await insert(f.db, "users", {
    school_id: f.school.id,
    name: "Legacy archived teacher",
    email: "legacy@allroles.test",
    password_hash: hashPassword(f.password),
    role: "TEACHER",
    status: "SUSPENDED",
    archived_at: new Date(),
  });
  const record = {
    version: 1,
    user: { id: teacher.id, name: teacher.name, role: "TEACHER" },
    attendance: [],
    assignments: [],
    documents: [],
  };
  await insert(f.db, "teacher_archives", {
    school_id: f.school.id,
    user_id: teacher.id,
    record: JSON.stringify(record),
  });
  await initializeSchema(f.db);
  await initializeSchema(f.db);
  const retained = await one(
    f.db,
    "SELECT record FROM account_archives WHERE user_id=$1",
    [teacher.id],
  );
  assert.deepEqual(retained.record, record);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT count(*)::int AS n FROM account_archives WHERE user_id=$1",
        [teacher.id],
      )
    ).n,
    1,
  );
});
