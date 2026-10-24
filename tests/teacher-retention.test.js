import { test, before, after } from "./database.js";
import { teacherRetentionFixture } from "./teacher-retention-fixture.js";
import { one } from "../server/db.js";
import { ensureTeacherStaff } from "../server/teacher-staff.js";
import assert from "node:assert/strict";
let f,
  server,
  base,
  clients = {};
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
async function login(key) {
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: f.users[key].email, password: f.password }),
  });
  return {
    status: r.status,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
    ...(await r.json()),
  };
}
before(async () => {
  f = await teacherRetentionFixture();
  server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const key of ["tenant", "owner", "teacher", "other", "parent"]) {
    const r = await login(key);
    assert.equal(r.status, 200);
    clients[key] = { ...r.data, cookie: r.cookie };
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (f) await f.db.close();
});
test("customer accounts are grouped by school and members are school-scoped with role filtering", async () => {
  const result = await request("/saas/owner/account-schools", {
    client: clients.owner,
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.total, 2);
  const school = result.data.schools.find((s) => s.id === f.school.id);
  assert.equal(school.administrator.id, f.users.tenant.id);
  assert.equal(school.role_counts.TEACHER, 1);
  assert.equal(school.role_counts.PARENT, 1);
  assert.equal(school.user_count, 4);
  assert.equal(school.retained_count, 0);
  const members = await request(
    `/saas/owner/users?school_id=${f.school.id}&role=TEACHER`,
    { client: clients.owner },
  );
  assert.equal(members.data.total, 1);
  assert.equal(members.data.users[0].id, f.users.teacher.id);
  const search = await request("/saas/owner/account-schools?search=mariam", {
    client: clients.owner,
  });
  assert.equal(search.data.total, 1);
  assert.equal(search.data.schools[0].id, f.school.id);
  assert.equal((await request("/saas/owner/account-schools")).status, 403);
});
test("only school administrators can remove their own teacher profiles", async () => {
  const path = `/users/${f.users.teacher.id}`;
  assert.equal(
    (
      await request(path, {
        client: clients.teacher,
        method: "DELETE",
        body: { reason: "Not authorized" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(path, {
        client: clients.other,
        method: "DELETE",
        body: { reason: "Wrong school" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/users/${f.users.parent.id}`, {
        method: "DELETE",
        body: { reason: "Not a teacher" },
      })
    ).status,
    422,
  );
  assert.equal(
    (await request(path, { method: "DELETE", body: { reason: "  " } })).status,
    422,
  );
});
test("teacher removal hides tenant profiles, ends login and preserves linked records", async () => {
  const result = await request(`/users/${f.users.teacher.id}`, {
    method: "DELETE",
    body: { reason: "Employment contract ended" },
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  for (const path of ["/users", "/hr/staff", "/attendance/staff"]) {
    const data = (await request(path)).data;
    assert.ok(
      !data.some(
        (r) =>
          (r.id === f.users.teacher.id && path === "/users") ||
          r.user_id === f.users.teacher.id ||
          r.staff_id === f.staff.id,
      ),
    );
  }
  assert.equal((await request("/me", { client: clients.teacher })).status, 401);
  assert.equal((await login("teacher")).status, 401);
  assert.equal(
    (
      await request(`/users/${f.users.teacher.id}`, {
        method: "PATCH",
        body: { role: "TEACHER", status: "ACTIVE" },
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(`/hr/staff/${f.staff.id}/documents`)).status,
    404,
  );
  assert.equal((await request(`/hr/documents/${f.document.id}`)).status, 404);
  const u = await one(f.db, "SELECT * FROM users WHERE id=$1", [
    f.users.teacher.id,
  ]);
  assert.ok(u.archived_at);
  assert.equal(u.archived_by, f.users.tenant.id);
  assert.equal(u.status, "SUSPENDED");
  assert.ok(
    (await one(f.db, "SELECT archived_at FROM staff WHERE id=$1", [f.staff.id]))
      .archived_at,
  );
  assert.ok(
    await one(f.db, "SELECT id FROM class_subjects WHERE id=$1", [
      f.assignment.id,
    ]),
  );
  assert.ok(
    await one(f.db, "SELECT id FROM staff_documents WHERE id=$1", [
      f.document.id,
    ]),
  );
  await ensureTeacherStaff(f.db, f.school.id);
  assert.equal(
    (
      await one(f.db, "SELECT count(*)::int AS n FROM staff WHERE user_id=$1", [
        f.users.teacher.id,
      ])
    ).n,
    1,
  );
  assert.equal((await request("/me", { client: clients.other })).status, 200);
});
test("owner can inspect and export retained teacher records; tenant cannot read them or reactivate removed accounts", async () => {
  const path = `/saas/owner/users/${f.users.teacher.id}/retained-record`;
  const record = await request(path, { client: clients.owner });
  assert.equal(record.status, 200, JSON.stringify(record));
  assert.equal(record.data.user.archive_reason, "Employment contract ended");
  assert.equal(record.data.profile.qualifications, "B.Ed Mathematics");
  assert.equal(record.data.counts.attendance, 1);
  assert.equal(record.data.counts.documents, 1);
  assert.equal(record.data.assignments[0].id, f.assignment.id);
  assert.equal((await request(path)).status, 403);
  assert.equal((await request(path, { client: clients.other })).status, 403);
  const exported = await request(path + "?download=1", {
    client: clients.owner,
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.attendance.length, 1);
  assert.equal(exported.documents.length, 1);
  assert.ok(!JSON.stringify(exported).includes("password_hash"));
  assert.ok(!JSON.stringify(exported).includes("retained-fixture-private-key"));
  const schools = (
    await request("/saas/owner/account-schools", { client: clients.owner })
  ).data;
  const school = schools.schools.find((s) => s.id === f.school.id);
  assert.equal(school.retained_count, 1);
  assert.equal(school.user_count, 3);
  const retained = await request(
    `/saas/owner/users?school_id=${f.school.id}&state=retained`,
    { client: clients.owner },
  );
  assert.equal(retained.data.users[0].id, f.users.teacher.id);
  assert.equal(
    (
      await request(`/saas/owner/users/${f.users.teacher.id}/action`, {
        client: clients.owner,
        method: "POST",
        body: {
          action: "UPDATE",
          status: "ACTIVE",
          reason: "Attempt reactivation",
        },
      })
    ).status,
    409,
  );
});

test("original retained documents are accessible only to the full owner and correct teacher", async () => {
  const path = `/saas/owner/users/${f.users.teacher.id}/retained-documents/${f.document.id}`;
  const response = await fetch(base + path, {
    headers: { cookie: clients.owner.cookie },
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition"),
    /employment-contract/,
  );
  assert.equal(await response.text(), "%PDF-retained-contract");
  assert.equal((await request(path)).status, 403);
  assert.equal(
    (
      await request(
        `/saas/owner/users/${f.users.foreignTeacher.id}/retained-documents/${f.document.id}`,
        { client: clients.owner },
      )
    ).status,
    404,
  );
});

test("the retained snapshot survives later school changes to teaching assignments", async () => {
  await f.db.query("UPDATE class_subjects SET teacher_user_id=$2 WHERE id=$1", [
    f.assignment.id,
    f.users.tenant.id,
  ]);
  await f.db.query("UPDATE classes SET name='Renamed class' WHERE id=$1", [
    f.cls.id,
  ]);
  const record = await request(
    `/saas/owner/users/${f.users.teacher.id}/retained-record`,
    { client: clients.owner },
  );
  assert.equal(record.status, 200);
  assert.equal(record.data.assignments.length, 1);
  assert.equal(record.data.assignments[0].class_name, "Primary 5");
  const snapshot = await one(
    f.db,
    "SELECT record FROM teacher_archives WHERE user_id=$1",
    [f.users.teacher.id],
  );
  assert.equal(snapshot.record.user.name, "Mariam Bello");
  assert.ok(!JSON.stringify(snapshot).includes("password_hash"));
});
