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
async function start(staff = "tenant", parent = "parent") {
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

test("messaging is limited to active school administrators and parents in the same school", async () => {
  const contacts = await call("parent", "/messages/contacts");
  assert.deepEqual(
    contacts.map((c) => c.recipient_id),
    [users.tenant.id],
  );
  assert.equal((await call("otherparent", "/messages/contacts")).length, 1);
  assert.equal((await call("tenant", "/messages/contacts")).length, 2);
  for (const who of [
    "teacher",
    "subject",
    "unrelated",
    "principal",
    "proprietor",
    "finance",
  ]) {
    await call(who, "/messages/contacts", "GET", undefined, 403);
    await call(who, "/messages", "GET", undefined, 403);
  }
  for (const recipient of ["teacher", "foreign", "otherparent"])
    await call(
      "parent",
      "/messages",
      "POST",
      { recipient_id: users[recipient].id },
      403,
    );
});

test("direct conversations work without a linked or enrolled child and are reused", async () => {
  const thread = await start("tenant", "otherparent");
  assert.equal(thread.student_id, null);
  const again = await call("tenant", "/messages", "POST", {
    recipient_id: users.otherparent.id,
  });
  assert.equal(again.id, thread.id);
  await send("otherparent", thread, "Can we discuss admission?");
  assert.ok(
    (await call("tenant", `/messages/${thread.id}`)).messages.length > 0,
  );
  await call("tenant", `/messages/${thread.id}/read`, "POST", {
    through_id: (await call("tenant", `/messages/${thread.id}`)).messages.at(-1)
      .id,
  });
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
    (await call("tenant", `/messages/${thread.id}`)).messages.length,
    1,
  );
  assert.equal(
    (await call("tenant", "/messages")).find((t) => t.id === thread.id)
      .unread_count,
    1,
  );
  assert.equal(
    (await call("tenant", "/subscription/notices/unread-count")).count,
    1,
  );
  assert.equal(
    (await call("parent", "/subscription/notices/unread-count")).count,
    0,
  );
  const inbox = (await call("tenant", "/subscription/notices")).filter(
    (n) => !n.read_at,
  );
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].source, "school");
  assert.equal(inbox[0].link, `#messages/${thread.id}`);
  assert.equal(
    (await call("principal", "/notifications")).some((n) =>
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
  await call("tenant", `/messages/${thread.id}/read`, "POST", {
    through_id: sent.id,
  });
  assert.equal(
    (await call("tenant", "/subscription/notices/unread-count")).count,
    0,
  );
  assert.ok(
    (await call("parent", `/messages/${thread.id}`)).messages[0].read_at,
  );
  await send("tenant", thread, "Happy to help!");
  assert.equal(
    (await call("parent", "/subscription/notices/unread-count")).count,
    1,
  );
});

test("conversation reads, sends and receipts enforce participant and school isolation", async () => {
  const thread = await start();
  for (const who of ["otherparent", "foreign"]) {
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
    assert.equal(
      (await call(who, "/messages")).some((t) => t.id === thread.id),
      false,
    );
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

test("online presence expires and revoked school membership loses access", async () => {
  await fixture.db.query(
    "UPDATE sessions SET last_seen_at=now()-interval '2 minutes' WHERE user_id=$1",
    [users.tenant.id],
  );
  assert.equal((await call("parent", "/messages/contacts"))[0].online, false);
  await call("tenant", "/subscription/notices/presence", "POST", {});
  assert.equal((await call("parent", "/messages/contacts"))[0].online, true);
  const thread = await start();
  await fixture.db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [
    users.tenant.id,
  ]);
  await call("parent", `/messages/${thread.id}`, "GET", undefined, 403);
  await call(
    "parent",
    `/messages/${thread.id}/send`,
    "POST",
    { body: "Old contact", client_key: randomUUID() },
    403,
  );
  assert.equal((await call("parent", "/messages")).length, 0);
  await fixture.db.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [
    users.tenant.id,
  ]);
});

test("reading through an older message leaves later messages and other recipients unread", async () => {
  const thread = await start();
  const first = await send("parent", thread, "First question");
  const second = await send("parent", thread, "Second question");
  await call("tenant", `/messages/${thread.id}/read`, "POST", {
    through_id: first.id,
  });
  const messages = (await call("tenant", `/messages/${thread.id}`)).messages;
  assert.ok(messages.find((m) => m.id === first.id).read_at);
  assert.equal(messages.find((m) => m.id === second.id).read_at, null);
  assert.equal(
    (await call("tenant", "/subscription/notices/unread-count")).count,
    1,
  );
});

test("school updates arrive in private conversations and parents can reply", async () => {
  await call("parent", "/subscription/notices/read-all", "POST", {});
  const result = await call("tenant", "/parent-messages", "POST", {
    recipient_ids: [users.parent.id, users.otherparent.id, users.parent.id],
    title: "Friday meeting",
    body: "Please attend the school meeting.",
  });
  assert.equal(result.count, 2);
  const notices = await call("otherparent", "/subscription/notices");
  const notice = notices.find((n) => n.title === "Friday meeting");
  assert.match(notice.link, /^#messages\//);
  const threadId = Number(notice.link.split("/")[1]);
  const thread = await call("otherparent", `/messages/${threadId}`);
  assert.ok(
    thread.messages.some(
      (m) => m.body === "Friday meeting\n\nPlease attend the school meeting.",
    ),
  );
  await call("otherparent", `/messages/${threadId}/read`, "POST", {
    through_id: thread.messages.at(-1).id,
  });
  assert.ok(
    (await call("otherparent", "/subscription/notices")).find(
      (n) => n.id === notice.id,
    ).read_at,
  );
  await send("otherparent", { id: threadId }, "We will be there.");
  assert.ok(
    (await call("tenant", `/messages/${threadId}`)).messages.some(
      (m) => m.body === "We will be there.",
    ),
  );
  const firstThread = (await call("parent", "/messages")).find(
    (t) => t.recipient_id === users.tenant.id,
  );
  assert.notEqual(firstThread.id, threadId);
});

test("long school updates preserve their complete content", async () => {
  const body = "x".repeat(5000);
  await call("tenant", "/parent-messages", "POST", {
    recipient_ids: [users.parent.id],
    title: "Long update",
    body,
  });
  const thread = await start();
  const messages = (await call("parent", `/messages/${thread.id}`)).messages;
  assert.equal(
    messages
      .slice(-2)
      .map((m) => m.body)
      .join(""),
    "Long update\n\n" + body,
  );
});

test("platform staff cannot enter school messaging or appear in parent contacts", async () => {
  await insert(fixture.db, "platform_staff", {
    user_id: users.tenant.id,
    scope: "TECHNICAL",
    created_by: fixture.users.owner.id,
  });
  try {
    await call("tenant", "/messages", "GET", undefined, 403);
    await call("tenant", "/parent-messages/recipients", "GET", undefined, 403);
    assert.equal((await call("parent", "/messages/contacts")).length, 0);
    assert.equal((await call("parent", "/messages")).length, 0);
  } finally {
    await fixture.db.query("DELETE FROM platform_staff WHERE user_id=$1", [
      users.tenant.id,
    ]);
  }
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
