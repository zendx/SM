import { settleSubscriptionPayment } from "../server/saas-service.js";
import { test, before, after } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import assert from "node:assert/strict";
let f,
  server,
  base,
  clients = {};
async function request(
  path,
  { client = clients.owner, method = "GET", body } = {},
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
  f = await accountFixture();
  const delegated = await insert(f.db, "users", {
    school_id: null,
    name: "Subscription delegate",
    email: "delegate@profile.test",
    role: "PLATFORM_OWNER",
    password_hash: hashPassword(f.password),
    email_verified: true,
  });
  await insert(f.db, "platform_staff", {
    user_id: delegated.id,
    scope: "SUBSCRIPTIONS",
    created_by: f.users.owner.id,
  });
  f.users.delegate = delegated;
  server = f.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const key of ["owner", "tenant", "other", "delegate"]) {
    const r = await login(key);
    assert.equal(r.status, 200, JSON.stringify(r));
    clients[key] = { ...r.data, cookie: r.cookie };
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (f) await f.db.close();
});
const deletion = () => ({
  reason: "School requested closure",
  confirmation: f.school.name,
});
test("owner suspends and restores tenant operational access without extending its trial", async () => {
  const end = (
    await one(
      f.db,
      "SELECT period_end FROM school_subscriptions WHERE school_id=$1",
      [f.school.id],
    )
  ).period_end;
  assert.equal(
    (
      await request(`/saas/owner/tenants/${f.school.id}`, {
        method: "PATCH",
        body: { action: "SUSPEND", reason: "Owner review" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/students", { client: clients.tenant })).status,
    402,
  );
  assert.equal(
    (await request("/students", { client: clients.other })).status,
    200,
  );
  assert.equal(
    (
      await request(`/saas/owner/tenants/${f.school.id}`, {
        method: "PATCH",
        body: { action: "RESTORE", reason: "Review complete" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/students", { client: clients.tenant })).status,
    200,
  );
  assert.equal(
    String(
      (
        await one(
          f.db,
          "SELECT period_end FROM school_subscriptions WHERE school_id=$1",
          [f.school.id],
        )
      ).period_end,
    ),
    String(end),
  );
});
test("tenant deletion requires full owner access and the exact school name", async () => {
  for (const key of ["tenant", "delegate"])
    assert.equal(
      (
        await request(`/saas/owner/tenants/${f.school.id}`, {
          client: clients[key],
          method: "DELETE",
          body: deletion(),
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await request(`/saas/owner/tenants/${f.school.id}`, {
        method: "DELETE",
        body: { ...deletion(), confirmation: f.users.owner.email },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(`/saas/owner/tenants/${f.school.id}`, {
        method: "DELETE",
        body: { ...deletion(), confirmation: "not-the-owner@example.com" },
      })
    ).status,
    422,
  );
  assert.equal(
    (await request("/students", { client: clients.tenant })).status,
    200,
  );
});
test("deleting a tenant closes sign-in, revokes sessions and renewal, and retains records with a safe audit", async () => {
  const payment = await insert(f.db, "subscription_payments", {
    school_id: f.school.id,
    reference: "delete-fixture",
    billing_cycle: "MONTHLY",
    amount_cents: 10000,
    method: "BANK",
    initiated_by: f.users.tenant.id,
  });
  await insert(f.db, "subscription_auto_renewals", {
    school_id: f.school.id,
    provider: "paystack",
    encrypted_method: "fixture",
    source_payment_id: payment.id,
    authorized_by: f.users.tenant.id,
    billing_cycle: "MONTHLY",
    amount_cents: 10000,
    charge_amount_cents: 10000,
    charge_currency: "NGN",
  });
  const r = await request(`/saas/owner/tenants/${f.school.id}`, {
    method: "DELETE",
    body: { confirmation: `  ${f.school.name}  ` },
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  const sub = await one(
    f.db,
    "SELECT * FROM school_subscriptions WHERE school_id=$1",
    [f.school.id],
  );
  assert.ok(sub.closed_at);
  assert.equal(sub.suspension_reason, "OWNER_DELETED");
  assert.equal((await request("/me", { client: clients.tenant })).status, 401);
  assert.equal((await login("tenant")).status, 403);
  assert.equal((await request("/me", { client: clients.owner })).status, 200);
  assert.equal(
    (await request("/students", { client: clients.other })).status,
    200,
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT enabled FROM subscription_auto_renewals WHERE school_id=$1",
        [f.school.id],
      )
    ).enabled,
    false,
  );
  assert.ok(
    await one(f.db, "SELECT id FROM schools WHERE id=$1", [f.school.id]),
  );
  assert.ok(
    await one(f.db, "SELECT id FROM users WHERE id=$1", [f.users.tenant.id]),
  );
  assert.ok(
    await one(f.db, "SELECT id FROM subscription_payments WHERE id=$1", [
      payment.id,
    ]),
  );
  const event = await one(
    f.db,
    "SELECT details FROM subscription_events WHERE school_id=$1 AND action='OWNER_ACCOUNT_DELETED'",
    [f.school.id],
  );
  assert.ok(!JSON.stringify(event).includes(f.password));
  assert.equal(event.details.records_retained, true);
  assert.equal(
    (
      await request(`/saas/owner/tenants/${f.school.id}`, {
        method: "DELETE",
        body: deletion(),
      })
    ).status,
    409,
  );
});
test("late payment confirmation does not reopen a deleted account", async () => {
  const payment = await one(
    f.db,
    "SELECT id FROM subscription_payments WHERE reference='delete-fixture'",
  );
  const result = await settleSubscriptionPayment(
    f.db,
    payment.id,
    f.users.owner.id,
  );
  assert.equal(result.status, "REVIEW");
  assert.ok(
    (
      await one(
        f.db,
        "SELECT closed_at FROM school_subscriptions WHERE school_id=$1",
        [f.school.id],
      )
    ).closed_at,
  );
});
test("owner can reactivate a deleted tenant without restarting the trial or automatic billing", async () => {
  const r = await request(`/saas/owner/tenants/${f.school.id}/reactivate`, {
    method: "POST",
    body: { reason: "School returned" },
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal((await login("tenant")).status, 200);
  assert.equal(
    (
      await one(
        f.db,
        "SELECT closed_at FROM school_subscriptions WHERE school_id=$1",
        [f.school.id],
      )
    ).closed_at,
    null,
  );
  assert.equal(
    (
      await one(
        f.db,
        "SELECT enabled FROM subscription_auto_renewals WHERE school_id=$1",
        [f.school.id],
      )
    ).enabled,
    false,
  );
});

test("the owner workspace cannot be deleted", async () => {
  await f.db.query("UPDATE users SET school_id=$2 WHERE id=$1", [
    f.users.owner.id,
    f.otherSchool.id,
  ]);
  try {
    const result = await request(`/saas/owner/tenants/${f.otherSchool.id}`, {
      method: "DELETE",
      body: { ...deletion(), confirmation: f.otherSchool.name },
    });
    assert.equal(result.status, 422);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT closed_at FROM school_subscriptions WHERE school_id=$1",
          [f.otherSchool.id],
        )
      ).closed_at,
      null,
    );
  } finally {
    await f.db.query("UPDATE users SET school_id=NULL WHERE id=$1", [
      f.users.owner.id,
    ]);
  }
});
