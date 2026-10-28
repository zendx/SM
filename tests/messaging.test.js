import { test, before, after } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { insert, one, rows } from "../server/db.js";
import { hashPassword, localClock } from "../server/security.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

let fixture, server, base, student, classroom;
const clients = {},
  users = {};
async function call(who, path, method = "GET", body, expected = 200) {
  const client = clients[who];
  const res = await fetch(base + path, {
    method,
    headers: {
      cookie: client.cookie,
      "x-csrf-token": client.csrf,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await res.json();
  assert.equal(res.status, expected, JSON.stringify(result));
  return result.data;
}
async function start(staff = "teacher", parent = "parent") {
  return call(parent, "/messages", "POST", {
    student_id: student.id,
    recipient_id: users[staff].id,
  });
}
async function send(who, thread, body = "Hello", client_key = randomUUID()) {
  return call(who, `/messages/${thread.id}/send`, "POST", { body, client_key });
}
before(async () => {
  fixture = await accountFixture();
  const { db, school, otherSchool, password } = fixture;
  users.tenant = fixture.users.tenant;
  users.foreign = fixture.users.other;
  for (const s of [school, otherSchool])
    await db.query(
      "INSERT INTO school_subscriptions(school_id,plan,status) VALUES($1,'FREE','TRIAL') ON CONFLICT DO NOTHING",
      [s.id],
    );
  for (const [key, role] of [
    ["parent", "PARENT"],
    ["otherparent", "PARENT"],
    ["teacher", "TEACHER"],
    ["unrelated", "TEACHER"],
    ["subject", "TEACHER"],
    ["principal", "PRINCIPAL"],
    ["proprietor", "PROPRIETOR"],
    ["finance", "FINANCE_OFFICER"],
  ])
    users[key] = await insert(db, "users", {
      school_id: school.id,
      name: key,
      email: `${key}@messaging.test`,
      role,
      password_hash: hashPassword(password),
      email_verified: true,
    });
  const year = await one(
    db,
    "SELECT id FROM academic_years WHERE school_id=$1",
    [school.id],
  );
  classroom = await insert(db, "classes", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Year 5",
    capacity: 30,
    teacher_user_id: users.teacher.id,
  });
  student = await insert(db, "students", {
    school_id: school.id,
    first_name: "Amina",
    last_name: "Test",
    gender: "FEMALE",
    date_of_birth: "2016-01-01",
    status: "ENROLLED",
    guardian_name: "Parent",
    guardian_phone: "08000000000",
    parent_user_id: users.parent.id,
    class_id: classroom.id,
  });
  const subject = await insert(db, "subjects", {
    school_id: school.id,
    name: "Science",
    code: "SCI",
  });
  await insert(db, "class_subjects", {
    school_id: school.id,
    class_id: classroom.id,
    subject_id: subject.id,
    teacher_user_id: users.subject.id,
  });
  server = fixture.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const [key, user] of Object.entries(users)) {
    const res = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password }),
    });
    const payload = await res.json();
    assert.equal(res.status, 200, JSON.stringify(payload));
    clients[key] = {
      cookie: res.headers.get("set-cookie").split(";")[0],
      csrf: payload.data.csrf,
    };
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (fixture) await fixture.db.close();
});

test("contacts include only the child's class/subject teachers and school leadership", async () => {
  const contacts = await call("parent", "/messages/contacts");
  assert.deepEqual(
    contacts.map((c) => c.recipient_id).sort((a, b) => a - b),
    ["tenant", "teacher", "subject", "principal", "proprietor"]
      .map((k) => users[k].id)
      .sort((a, b) => a - b),
  );
  assert.equal((await call("otherparent", "/messages/contacts")).length, 0);
  assert.equal((await call("unrelated", "/messages/contacts")).length, 0);
  assert.equal(
    (await call("teacher", "/messages/contacts"))[0].recipient_id,
    users.parent.id,
  );
  await call(
    "parent",
    "/messages",
    "POST",
    { student_id: student.id, recipient_id: users.unrelated.id },
    403,
  );
  await call(
    "parent",
    "/messages",
    "POST",
    { student_id: student.id, recipient_id: users.foreign.id },
    403,
  );
  await call(
    "otherparent",
    "/messages",
    "POST",
    { student_id: student.id, recipient_id: users.teacher.id },
    403,
  );
  await call("finance", "/messages/contacts", "GET", undefined, 403);
});
test("messages persist offline, notify only the recipient, and deduplicate retries", async () => {
  const thread = await start();
  const key = randomUUID();
  const sent = await send("parent", thread, "Please help with homework.", key);
  assert.equal(
    (await send("parent", thread, "Please help with homework.", key)).id,
    sent.id,
  );
  assert.equal(
    (await call("teacher", `/messages/${thread.id}`)).messages.length,
    1,
  );
  assert.equal((await call("teacher", "/messages"))[0].unread_count, 1);
  assert.equal(
    (await call("teacher", "/subscription/notices/unread-count")).count,
    1,
  );
  assert.equal(
    (await call("parent", "/subscription/notices/unread-count")).count,
    0,
  );
  const inbox = await call("teacher", "/subscription/notices");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].source, "school");
  assert.equal(inbox[0].link, `#conversations/${thread.id}`);
  assert.equal(
    (await call("tenant", "/notifications")).some((n) =>
      n.body.includes("Please help with homework."),
    ),
    false,
  );
  await call(
    "otherparent",
    `/subscription/notices/school/${inbox[0].id}/read`,
    "POST",
    {},
    404,
  );
  await call("teacher", `/messages/${thread.id}/read`, "POST", {
    through_id: sent.id,
  });
  assert.equal(
    (await call("teacher", "/subscription/notices/unread-count")).count,
    0,
  );
  assert.ok(
    (await call("parent", `/messages/${thread.id}`)).messages[0].read_at,
  );
  await send("teacher", thread, "Happy to help!");
  assert.equal(
    (await call("parent", "/subscription/notices/unread-count")).count,
    1,
  );
});
test("conversation reads, sends and read receipts enforce participant and school isolation", async () => {
  const thread = await start();
  for (const who of ["otherparent", "unrelated", "foreign"]) {
    await call(who, `/messages/${thread.id}`, "GET", undefined, 404);
    await call(
      who,
      `/messages/${thread.id}/send`,
      "POST",
      { body: "Forbidden", client_key: randomUUID() },
      404,
    );
    await call(
      who,
      `/messages/${thread.id}/read`,
      "POST",
      { through_id: 999999 },
      404,
    );
    assert.equal((await call(who, "/messages")).length, 0);
  }
  const res = await fetch(base + `/messages/${thread.id}/send`, {
    method: "POST",
    headers: {
      cookie: clients.parent.cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ body: "No CSRF", client_key: randomUUID() }),
  });
  assert.equal(res.status, 403);
  await call(
    "parent",
    `/messages/${thread.id}/send`,
    "POST",
    { body: "  ", client_key: randomUUID() },
    422,
  );
});
test("online presence expires and revoked teaching or parent relationships lose access", async () => {
  await fixture.db.query(
    "UPDATE sessions SET last_seen_at=now()-interval '2 minutes' WHERE user_id=$1",
    [users.teacher.id],
  );
  let contacts = await call("parent", "/messages/contacts");
  assert.equal(
    contacts.find((c) => c.recipient_id === users.teacher.id).online,
    false,
  );
  await call("teacher", "/subscription/notices/presence", "POST", {});
  contacts = await call("parent", "/messages/contacts");
  assert.equal(
    contacts.find((c) => c.recipient_id === users.teacher.id).online,
    true,
  );
  const thread = await start();
  await fixture.db.query("UPDATE classes SET teacher_user_id=$2 WHERE id=$1", [
    classroom.id,
    users.unrelated.id,
  ]);
  await call("teacher", `/messages/${thread.id}`, "GET", undefined, 403);
  await call(
    "parent",
    `/messages/${thread.id}/send`,
    "POST",
    { body: "Old teacher", client_key: randomUUID() },
    403,
  );
  await fixture.db.query("UPDATE classes SET teacher_user_id=$2 WHERE id=$1", [
    classroom.id,
    users.teacher.id,
  ]);
  await fixture.db.query("UPDATE students SET parent_user_id=$2 WHERE id=$1", [
    student.id,
    users.otherparent.id,
  ]);
  await call("parent", `/messages/${thread.id}`, "GET", undefined, 403);
  await fixture.db.query("UPDATE students SET parent_user_id=$2 WHERE id=$1", [
    student.id,
    users.parent.id,
  ]);
});
test("reading through an older message leaves later messages and other recipients unread", async () => {
  const thread = await start("principal");
  const first = await send("parent", thread, "First question");
  const second = await send("parent", thread, "Second question");
  await call("principal", `/messages/${thread.id}/read`, "POST", {
    through_id: first.id,
  });
  const messages = (await call("principal", `/messages/${thread.id}`)).messages;
  assert.ok(messages.find((m) => m.id === first.id).read_at);
  assert.equal(messages.find((m) => m.id === second.id).read_at, null);
  assert.equal(
    (await call("principal", "/subscription/notices/unread-count")).count,
    1,
  );
});
test("complaints notify tenant/leadership, school updates notify parents, feedback notifies leadership", async () => {
  const complaint = await call("parent", "/operations/cases", "POST", {
    kind: "COMPLAINT",
    category: "OTHER",
    description: "Please review collection arrangements.",
    event_date: localClock("Africa/Lagos").date,
    student_id: student.id,
  });
  for (const who of ["tenant", "principal", "proprietor", "parent"]) {
    const inbox = await call(who, "/subscription/notices");
    assert.ok(
      inbox.some((n) => n.body.includes(`CASE-${complaint.id}`)),
      who,
    );
    assert.ok(
      (await call(who, "/subscription/notices/unread-count")).count > 0,
      who,
    );
  }
  assert.equal(
    (await call("foreign", "/subscription/notices/unread-count")).count,
    0,
  );
  await call("proprietor", `/operations/cases/${complaint.id}`);
  for (const stage of [
    "ACKNOWLEDGED",
    "ASSIGNED",
    "INVESTIGATED",
    "RESPONSE_PROVIDED",
    "RESOLVED",
  ])
    await call("tenant", `/operations/cases/${complaint.id}/stage`, "POST", {
      stage,
      note: `School response: ${stage}`,
    });
  const inbox = await call("parent", "/subscription/notices");
  assert.ok(inbox.some((n) => n.body === "School response: ACKNOWLEDGED"));
  await call("parent", `/operations/cases/${complaint.id}/stage`, "POST", {
    stage: "PARENT_FEEDBACK",
    note: "Thank you for resolving this.",
    feedback_score: 5,
  });
  for (const who of ["tenant", "principal", "proprietor"])
    assert.ok(
      (await call(who, "/subscription/notices")).some(
        (n) => n.title === `Parent feedback on CASE-${complaint.id}`,
      ),
    );
  await call("parent", "/subscription/notices/read-all", "POST", {});
  assert.equal(
    (await call("parent", "/subscription/notices/unread-count")).count,
    0,
  );
  assert.ok(
    (await call("tenant", "/subscription/notices/unread-count")).count > 0,
  );
});
