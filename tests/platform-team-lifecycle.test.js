import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { testMailbox } from "./mailbox.js";
import { createApp } from "../server/app.js";
import { one } from "../server/db.js";
import { finalizeClosures } from "../server/account-lifecycle.js";

test("department delegation and tenant account lifecycle enforce access boundaries", async () => {
  const verifyEmail = testMailbox();
  const db = await openTestDatabase();
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const password = "Team-lifecycle-2026!";
  async function call(path, { session, method = "GET", body, portal } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
        ...(portal ? { "x-smpis-portal": portal } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      ...(await res.json()),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(email, owner = false) {
    await verifyEmail(email, base);
    const result = await call(owner ? "/auth/owner/login" : "/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    return { cookie: result.cookie, ...result.data };
  }
  try {
    assert.equal(
      (
        await call("/auth/owner/setup", {
          method: "POST",
          body: { name: "Owner", email: "owner@team.test", password },
        })
      ).status,
      201,
    );
    const owner = await login("owner@team.test", true);
    const tenants = [];
    for (const slug of ["first-school", "second-school"]) {
      const registered = await call("/saas/register", {
        method: "POST",
        body: {
          school_name: slug,
          portal_slug: slug,
          name: "School Admin",
          email: `${slug}@team.test`,
          password,
          plan: "FREE",
          year_name: "2026",
          start_date: "2026-01-01",
          end_date: "2026-12-31",
        },
      });
      assert.equal(registered.status, 201, JSON.stringify(registered));
      tenants.push({
        id: registered.data.school.id,
        session: await login(`${slug}@team.test`),
      });
    }
    const school = tenants[0];
    const tickets = {};
    for (const department of ["SALES", "TECHNICAL"]) {
      const ticket = await call("/subscription/support", {
        session: school.session,
        method: "POST",
        body: {
          department,
          subject: department + " help",
          description: "Please help our school with this request.",
        },
      });
      assert.equal(ticket.status, 201);
      tickets[department] = ticket.data;
    }
    const staff = {};
    for (const scope of ["SALES", "TECHNICAL", "SUBSCRIPTIONS"]) {
      const email = scope.toLowerCase() + "@team.test";
      const created = await call("/saas/owner/team", {
        session: owner,
        method: "POST",
        body: { name: scope + " Staff", email, password, scope },
      });
      assert.equal(created.status, 201, JSON.stringify(created));
      assert.equal(
        (
          await call("/auth/owner/login", {
            method: "POST",
            body: { email, password },
          })
        ).status,
        403,
      );
      staff[scope] = await login(email, true);
      assert.equal(staff[scope].user.platform_operator, false);
      assert.equal(staff[scope].user.console_access, true);
      assert.equal(staff[scope].user.platform_scope, scope);
      for (const path of [
        "/saas/owner",
        "/saas/owner/team",
        "/saas/owner/users",
        "/saas/owner/export?kind=payments",
        "/config",
        "/users",
      ]) {
        assert.equal(
          (await call(path, { session: staff[scope] })).status,
          403,
          `${scope} ${path}`,
        );
      }
      assert.equal(
        (await call("/me", { session: staff[scope], portal: "first-school" }))
          .status,
        403,
      );
      assert.equal(
        (
          await call("/saas/owner/team", {
            session: staff[scope],
            method: "POST",
            body: {
              name: "Escalate",
              email: "evil@test.com",
              password,
              scope: "SUBSCRIPTIONS",
            },
          })
        ).status,
        403,
      );
    }
    assert.equal(
      (await call("/saas/owner/issues", { session: owner })).data.length,
      2,
    );
    for (const department of ["SALES", "TECHNICAL"]) {
      const scoped = await call("/saas/owner/issues", {
        session: staff[department],
      });
      assert.equal(scoped.status, 200);
      assert.deepEqual(
        scoped.data.map((t) => t.department),
        [department],
      );
      const other = department === "SALES" ? "TECHNICAL" : "SALES";
      assert.equal(
        (
          await call(`/saas/owner/issues/${tickets[other].id}`, {
            session: staff[department],
            method: "PATCH",
            body: { status: "RESOLVED", resolution: "Wrong department" },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(`/saas/owner/issues/${tickets[department].id}`, {
            session: staff[department],
            method: "PATCH",
            body: {
              status: "RESOLVED",
              resolution: "Resolved by assigned department",
            },
          })
        ).status,
        200,
      );
    }
    assert.equal(
      (await call("/saas/owner/issues", { session: staff.SUBSCRIPTIONS }))
        .status,
      403,
    );
    const schoolList = await call("/saas/owner/tenants", {
      session: staff.SUBSCRIPTIONS,
    });
    assert.equal(schoolList.status, 200);
    assert.equal(schoolList.data.length, 2);
    assert.equal("students" in schoolList.data[0], false);
    assert.equal(
      (await call("/saas/owner/tenants", { session: staff.SALES })).status,
      403,
    );
    assert.equal(
      (
        await call(`/saas/owner/tenants/${tenants[1].id}`, {
          session: staff.SUBSCRIPTIONS,
          method: "PATCH",
          body: { action: "SUSPEND", reason: "Customer request" },
        })
      ).status,
      200,
    );
    const initial = await one(
      db,
      "SELECT * FROM school_subscriptions WHERE school_id=$1",
      [school.id],
    );
    const change = (action, pass = password) =>
      call("/subscription/account", {
        session: school.session,
        method: "POST",
        body: {
          action,
          password: pass,
          reason: "Our school requested this change",
        },
      });
    assert.equal((await change("PAUSE", "wrong-password")).status, 422);
    assert.equal((await change("PAUSE")).status, 200);
    assert.equal(
      (await call("/users", { session: school.session })).status,
      402,
    );
    assert.equal(
      (await call("/subscription/support", { session: school.session })).status,
      200,
    );
    assert.equal(
      (
        await call("/subscription/bank", {
          session: school.session,
          method: "POST",
          body: { billing_cycle: "MONTHLY", transfer_reference: "PAUSED" },
        })
      ).status,
      403,
    );
    assert.equal((await change("RESUME")).status, 200);
    assert.equal(
      new Date(
        (
          await one(
            db,
            "SELECT period_end FROM school_subscriptions WHERE school_id=$1",
            [school.id],
          )
        ).period_end,
      ).getTime(),
      new Date(initial.period_end).getTime(),
    );
    const deleted = await change("DELETE");
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.suspension_reason, "DELETION_REQUESTED");
    const interval = await one(
      db,
      "SELECT deletion_effective_at=deletion_requested_at+interval '3 months' AS correct FROM school_subscriptions WHERE school_id=$1",
      [school.id],
    );
    assert.equal(interval.correct, true);
    assert.equal(
      (await call("/users", { session: school.session })).status,
      402,
    );
    assert.equal(
      (
        await call("/subscription/support", {
          session: school.session,
          method: "POST",
          body: {
            department: "SALES",
            subject: "Reactivation",
            description: "Please help reactivate our account.",
          },
        })
      ).status,
      201,
    );
    assert.equal((await change("DELETE")).status, 409);
    assert.equal((await change("RESUME")).status, 409);
    assert.equal(
      (
        await call(`/saas/owner/tenants/${school.id}`, {
          session: staff.SUBSCRIPTIONS,
          method: "PATCH",
          body: { action: "RESTORE", reason: "Try restore" },
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await call(`/saas/owner/tenants/${school.id}/reactivate`, {
          session: staff.SUBSCRIPTIONS,
          method: "POST",
          body: { reason: "Try escalate" },
        })
      ).status,
      403,
    );
    await db.query(
      "UPDATE school_subscriptions SET deletion_effective_at=now()-interval '1 second' WHERE school_id=$1",
      [school.id],
    );
    assert.equal((await call("/me", { session: school.session })).status, 403);
    assert.equal(
      (
        await call("/auth/login", {
          method: "POST",
          body: { email: "first-school@team.test", password },
        })
      ).status,
      403,
    );
    await finalizeClosures(db);
    const closed = await one(
      db,
      "SELECT * FROM school_subscriptions WHERE school_id=$1",
      [school.id],
    );
    assert.ok(closed.closed_at);
    assert.equal(closed.suspension_reason, "ACCOUNT_CLOSED");
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM users WHERE school_id=$1",
          [school.id],
        )
      ).n,
      1,
    );
    assert.equal(
      (
        await call("/saas/register", {
          method: "POST",
          body: {
            school_name: "Replacement",
            portal_slug: "replacement-school",
            name: "Admin",
            email: "first-school@team.test",
            password,
            plan: "FREE",
            year_name: "2026",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
          },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(`/saas/owner/tenants/${school.id}/reactivate`, {
          session: owner,
          method: "POST",
          body: { reason: "Verified customer requested reactivation" },
        })
      ).status,
      200,
    );
    await login("first-school@team.test");
    assert.equal(
      new Date(
        (
          await one(
            db,
            "SELECT trial_ends_at FROM school_subscriptions WHERE school_id=$1",
            [school.id],
          )
        ).trial_ends_at,
      ).getTime(),
      new Date(initial.trial_ends_at).getTime(),
    );
    const team = (await call("/saas/owner/team", { session: owner })).data;
    const sales = team.find((u) => u.scope === "SALES");
    assert.equal(
      (
        await call(`/saas/owner/team/${sales.id}`, {
          session: owner,
          method: "PATCH",
          body: {
            scope: "TECHNICAL",
            status: "ACTIVE",
            reason: "Reassign staff member",
          },
        })
      ).status,
      200,
    );
    assert.equal((await call("/me", { session: staff.SALES })).status, 401);
    const reassigned = await login("sales@team.test", true);
    assert.deepEqual(
      (await call("/saas/owner/issues", { session: reassigned })).data.map(
        (t) => t.department,
      ),
      ["TECHNICAL"],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
