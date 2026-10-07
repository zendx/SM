import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { testMailbox } from "./mailbox.js";
import { createApp } from "../server/app.js";
import { insert, one, rows } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { deliverPlatformNotifications } from "../server/platform-notifications.js";

test("tenant phones, contact export, scoped notices and offline support email delivery", async () => {
  const verify = testMailbox(),
    db = await openTestDatabase();
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`,
    password = "Notifications-2026!";
  async function call(path, session, body, method = body ? "POST" : "GET") {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = response.headers
      .get("content-type")
      ?.includes("application/json");
    return {
      status: response.status,
      ...(json ? await response.json() : { text: await response.text() }),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(email, owner = false) {
    await verify(email, base);
    const result = await call(
      owner ? "/auth/owner/login" : "/auth/login",
      null,
      { email, password },
    );
    assert.equal(result.status, 200, JSON.stringify(result));
    return { ...result.data, cookie: result.cookie };
  }
  try {
    await call("/auth/owner/setup", null, {
      name: "Owner",
      email: "owner@notices.test",
      password,
    });
    const owner = await login("owner@notices.test", true),
      schools = [];
    for (const slug of ["one-school", "two-school"]) {
      const registration = {
        school_name: slug,
        phone_number: "+2348012345678",
        portal_slug: slug,
        name: "Admin",
        email: `${slug}@notices.test`,
        password,
        plan: "FREE",
        year_name: "2026",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      };
      assert.equal(
        (
          await call("/saas/register", null, {
            ...registration,
            phone_number: "abc",
          })
        ).status,
        422,
      );
      const { phone_number, ...missingPhone } = registration;
      assert.equal(
        (await call("/saas/register", null, missingPhone)).status,
        422,
      );
      const created = await call("/saas/register", null, registration);
      assert.equal(created.status, 201, JSON.stringify(created));
      schools.push({
        id: created.data.school.id,
        session: await login(registration.email),
      });
    }
    const technicalUser = await insert(db, "users", {
      school_id: null,
      role: "PLATFORM_STAFF",
      name: "Technical",
      email: "tech@notices.test",
      password_hash: hashPassword(password),
    });
    await insert(db, "platform_staff", {
      user_id: technicalUser.id,
      scope: "TECHNICAL",
      created_by: owner.user.id,
    });
    const technical = await login(technicalUser.email, true);
    const contacts = await call("/saas/owner/contacts", owner);
    assert.equal(contacts.data.length, 2);
    assert.equal(contacts.data[0].phone_number, "+2348012345678");
    assert.ok(
      (await call("/saas/owner/contacts?format=csv", owner)).text.includes(
        "one-school@notices.test",
      ),
    );
    assert.equal((await call("/saas/owner/contacts", technical)).status, 403);
    assert.equal(
      (
        await call("/saas/owner/notifications", schools[0].session, {
          title: "No",
          body: "No",
          audience: "ALL",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/saas/owner/notifications", technical, {
          title: "No",
          body: "No",
          audience: "ALL",
        })
      ).status,
      403,
    );
    const sent = await call("/saas/owner/notifications", owner, {
      title: "Individual announcement",
      body: "For the first school only",
      audience: "SELECTED",
      school_ids: [schools[0].id],
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.recipients, 1);
    const inbox = (await call("/subscription/notices", schools[0].session))
      .data;
    assert.equal(inbox.length, 1);
    assert.equal(
      (await call("/subscription/notices", schools[1].session)).data.length,
      0,
    );
    assert.equal(
      (
        await call(
          `/subscription/notices/${inbox[0].id}/read`,
          schools[1].session,
          {},
        )
      ).status,
      404,
    );
    const deliveries = [];
    const options = {
      configuration: async () => ({ transport: {}, from: "test@smpis.test" }),
      send: async (smtp, notice) => deliveries.push(notice),
    };
    await call("/subscription/notices/presence", schools[0].session, {});
    await deliverPlatformNotifications(db, options);
    assert.equal(deliveries.length, 0);
    await db.query(
      "UPDATE sessions SET last_seen_at=now()-interval '3 minutes' WHERE user_id=$1",
      [schools[0].session.user.id],
    );
    await deliverPlatformNotifications(db, options);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].email, "one-school@notices.test");
    await deliverPlatformNotifications(db, options);
    assert.equal(deliveries.length, 1);
    assert.equal(
      (
        await call("/saas/owner/notifications", owner, {
          title: "Bulk announcement",
          body: "Both schools",
          audience: "ALL",
        })
      ).data.recipients,
      2,
    );
    const bulk = (await call("/subscription/notices", schools[1].session))
      .data[0];
    await call(`/subscription/notices/${bulk.id}/read`, schools[1].session, {});
    await deliverPlatformNotifications(db, options);
    assert.equal(
      deliveries.some((n) => n.id === bulk.id),
      false,
    );
    const ticket = await call("/subscription/support", schools[0].session, {
      department: "TECHNICAL",
      subject: "Help with setup",
      description: "Please help our school configure attendance.",
    });
    assert.equal(ticket.status, 201);
    const ownerInbox = (await call("/subscription/notices", owner)).data;
    assert.equal(ownerInbox.length, 1);
    assert.equal(
      (await call("/subscription/notices", technical)).data.length,
      1,
    );
    await call("/subscription/notices/presence", owner, {});
    await deliverPlatformNotifications(db, options);
    assert.equal(
      deliveries.some((n) => n.user_id === technical.user.id),
      true,
    );
    assert.equal(
      deliveries.some((n) => n.user_id === owner.user.id),
      false,
    );
    await call(
      `/saas/owner/issues/${ticket.data.id}`,
      technical,
      {
        status: "RESOLVED",
        resolution: "The Technical Department has fixed your issue.",
      },
      "PATCH",
    );
    const reply = (
      await call("/subscription/notices", schools[0].session)
    ).data.find((n) => n.title.includes("replied"));
    assert.ok(reply.body.includes("fixed your issue"));
    assert.equal(
      (await call("/subscription/notices", schools[1].session)).data.some((n) =>
        n.title.includes("replied"),
      ),
      false,
    );
    await deliverPlatformNotifications(db, options);
    assert.equal(
      deliveries.some((n) => n.id === reply.id),
      true,
    );
    const pending = await one(
      db,
      "SELECT id FROM platform_notifications WHERE user_id=$1 AND email_status='PENDING'",
      [owner.user.id],
    );
    await db.query(
      "UPDATE sessions SET last_seen_at=now()-interval '3 minutes' WHERE user_id=$1",
      [owner.user.id],
    );
    await deliverPlatformNotifications(db, {
      ...options,
      send: async () => {
        throw new Error("Provider failed");
      },
    });
    assert.equal(
      (
        await one(
          db,
          "SELECT attempts FROM platform_notifications WHERE id=$1",
          [pending.id],
        )
      ).attempts,
      1,
    );
    await deliverPlatformNotifications(db, options);
    assert.equal(
      (
        await one(
          db,
          "SELECT email_status FROM platform_notifications WHERE id=$1",
          [pending.id],
        )
      ).email_status,
      "SENT",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
