import { test, before, after } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { one } from "../server/db.js";
import assert from "node:assert/strict";
let fixture,
  server,
  base,
  clients = {};
async function request(path, { client, method = "GET", body, csrf } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(client
        ? { cookie: client.cookie, "x-csrf-token": csrf ?? client.csrf }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, ...(await res.json()) };
}
before(async () => {
  fixture = await accountFixture();
  server = fixture.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const key of ["owner", "tenant", "other"]) {
    const res = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: fixture.users[key].email,
        password: fixture.password,
      }),
    });
    assert.equal(res.status, 200);
    clients[key] = {
      ...(await res.json()).data,
      cookie: res.headers.get("set-cookie").split(";")[0],
    };
  }
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (fixture) await fixture.db.close();
});
const values = {
  name: "Grace Updated",
  phone_number: "+234 802 123 4567",
  address: "12 School Road\nLagos, Nigeria",
};
test("tenant profile persists contact details, updates the session identity and leaves school details unchanged", async () => {
  const result = await request("/auth/profile", {
    client: clients.tenant,
    method: "PATCH",
    body: values,
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.email, fixture.users.tenant.email);
  const me = (await request("/me", { client: clients.tenant })).data.user;
  for (const key of Object.keys(values)) assert.equal(me[key], values[key]);
  assert.equal(
    (
      await one(fixture.db, "SELECT name FROM schools WHERE id=$1", [
        fixture.school.id,
      ])
    ).name,
    "Greenfield Academy",
  );
  assert.equal(
    (await request("/me", { client: clients.other })).data.user.name,
    "Other Administrator",
  );
});
test("profile updates require authentication and CSRF and reject email, role and target account changes", async () => {
  assert.equal(
    (await request("/auth/profile", { method: "PATCH", body: values })).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/profile", {
        client: clients.tenant,
        csrf: "invalid",
        method: "PATCH",
        body: values,
      })
    ).status,
    403,
  );
  for (const extra of [
    { email: "changed@profile.test" },
    { role: "PLATFORM_OWNER" },
    { id: fixture.users.other.id },
    { school_id: fixture.otherSchool.id },
  ])
    assert.equal(
      (
        await request("/auth/profile", {
          client: clients.tenant,
          method: "PATCH",
          body: { ...values, ...extra },
        })
      ).status,
      422,
    );
  assert.equal(
    (await request("/me", { client: clients.tenant })).data.user.email,
    fixture.users.tenant.email,
  );
});
test("profile validates name, phone and address without partially saving invalid data", async () => {
  for (const invalid of [
    { name: "   " },
    { phone_number: "not a phone" },
    { phone_number: "123" },
    { address: "a".repeat(501) },
  ])
    assert.equal(
      (
        await request("/auth/profile", {
          client: clients.tenant,
          method: "PATCH",
          body: { ...values, ...invalid },
        })
      ).status,
      422,
    );
  assert.equal(
    (await request("/me", { client: clients.tenant })).data.user.name,
    values.name,
  );
});
test("owner can manage their own contact details and audit them without a school", async () => {
  const result = await request("/auth/profile", {
    client: clients.owner,
    method: "PATCH",
    body: {
      name: "Updated Owner",
      phone_number: "+2348098765432",
      address: "Owner office, Abuja",
    },
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  const me = (await request("/me", { client: clients.owner })).data.user;
  assert.equal(me.name, "Updated Owner");
  assert.equal(me.school_id, null);
  assert.equal(me.address, "Owner office, Abuja");
  const audit = await one(
    fixture.db,
    "SELECT school_id,new_value FROM audit_logs WHERE user_id=$1 AND action='PROFILE_UPDATED'",
    [me.id],
  );
  assert.equal(audit.school_id, null);
  assert.equal(audit.new_value.name, "Updated Owner");
});
test("optional contact details can be cleared", async () => {
  const result = await request("/auth/profile", {
    client: clients.tenant,
    method: "PATCH",
    body: { name: values.name, phone_number: "", address: "" },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.phone_number, "");
  assert.equal(result.data.address, "");
});

test("account contact details remain accessible while a school subscription is suspended", async () => {
  await fixture.db.query(
    "UPDATE school_subscriptions SET status='SUSPENDED' WHERE school_id=$1",
    [fixture.school.id],
  );
  const result = await request("/auth/profile", {
    client: clients.tenant,
    method: "PATCH",
    body: { ...values, name: "Suspended tenant contact" },
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(
    (await request("/students", { client: clients.tenant })).status,
    402,
  );
});
