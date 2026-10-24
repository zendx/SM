import { testMailbox } from "./mailbox.js";
const verifyEmail = testMailbox();
import { test, before, after, openTestDatabase } from "./database.js";
import { test as unitTest } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { one, insert } from "../server/db.js";
import { initializeSchema } from "../server/schema.js";
import { settleSubscriptionPayment } from "../server/saas-service.js";
import { referralPayoutDue } from "../server/referrals.js";
import { MARKETER_TERMS_VERSION } from "../shared/marketer-terms.js";
import { hashPassword } from "../server/security.js";
import PDFDocument from "pdfkit";
import { drawPaymentReceipt } from "../server/payment-receipt.js";

const password = "School-referral-test-2026!";
let db, server, base, owner, marketer, tenant, school, code, commission;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function request(path, { client, method = "GET", body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  return { status: res.status, ...payload };
}
async function login(email) {
  await verifyEmail(email, base);
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  return { ...json.data, cookie: res.headers.get("set-cookie").split(";")[0] };
}
function registration(slug, referral_code = code) {
  return {
    school_name: slug + " School",
    portal_slug: slug,
    name: "Administrator",
    email: slug + "@referral.test",
    password,
    phone_number: "+2348012345678",
    privacy_accepted: true,
    plan: "PRO",
    year_name: "2026/27",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    referral_code,
  };
}
async function payment({
  schoolId = school.id,
  mode = "LIVE",
  total = 15000000,
  currency = "NGN",
} = {}) {
  return insert(db, "subscription_payments", {
    school_id: schoolId,
    reference: "referral-test-" + Math.random(),
    billing_cycle: "MONTHLY",
    amount_cents: 10000,
    currency: "USD",
    method: "BANK",
    mode,
    charge_amount_cents: total,
    charge_currency: currency,
    initiated_by: tenant.user.id,
  });
}
before(async () => {
  db = await openTestDatabase();
  server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const result = await request("/auth/owner/setup", {
    method: "POST",
    body: { name: "Owner", email: "owner@referral.test", password },
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  owner = await login("owner@referral.test");
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});
unitTest(
  "commission payout date is three calendar days after approval and preserves time",
  () => {
    assert.equal(
      referralPayoutDue("2026-10-23T12:00:00Z").toISOString(),
      "2026-10-26T12:00:00.000Z",
    );
    assert.equal(
      referralPayoutDue("2026-10-22T12:00:00Z").toISOString(),
      "2026-10-25T12:00:00.000Z",
    );
    assert.equal(
      referralPayoutDue("2026-10-25T23:30:00Z").toISOString(),
      "2026-10-28T23:30:00.000Z",
    );
  },
);
test("marketer signup rejects absent, unchecked or outdated terms without creating an account", async () => {
  for (const acceptance of [
    {},
    { terms_accepted: false, terms_version: MARKETER_TERMS_VERSION },
    { terms_accepted: true, terms_version: "outdated" },
  ]) {
    const result = await request("/referrals/register", {
      method: "POST",
      body: {
        name: "Unaccepted Marketer",
        email: "unaccepted@referral.test",
        password,
        privacy_accepted: true,
        ...acceptance,
      },
    });
    assert.equal(result.status, 422, JSON.stringify(result));
  }
  assert.equal(
    await one(
      db,
      "SELECT id FROM users WHERE email='unaccepted@referral.test'",
    ),
    undefined,
  );
});
test("verified marketer signup is separate from school and owner access", async () => {
  const result = await request("/referrals/register", {
    method: "POST",
    body: {
      name: "Marketer One",
      email: "marketer@referral.test",
      password,
      privacy_accepted: true,
      terms_accepted: true,
      terms_version: MARKETER_TERMS_VERSION,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  marketer = await login("marketer@referral.test");
  assert.equal(marketer.user.role, "MARKETER");
  assert.equal(marketer.user.school_id, null);
  const account = await request("/referrals/account", { client: marketer });
  assert.equal(account.status, 200);
  assert.equal(account.data.account.terms_version, MARKETER_TERMS_VERSION);
  assert.ok(account.data.account.terms_accepted_at);
  code = account.data.account.code;
  assert.equal((await request("/config", { client: marketer })).status, 403);
  assert.equal(
    (await request("/saas/owner/referrals", { client: marketer })).status,
    403,
  );
  assert.equal(
    (
      await request("/saas/owner/referrals/settings", {
        client: owner,
        method: "PATCH",
        body: { referral_percent: 12.5 },
      })
    ).status,
    200,
  );
});
test("registration validates referral code and records attributable school signup", async () => {
  assert.equal(
    (
      await request("/saas/register", {
        method: "POST",
        body: registration("bad-referral", "UNKNOWN"),
      })
    ).status,
    422,
  );
  assert.equal(
    await one(db, "SELECT id FROM schools WHERE portal_slug='bad-referral'"),
    undefined,
  );
  const result = await request("/saas/register", {
    method: "POST",
    body: registration("referred-school", code.toLowerCase()),
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  school = result.data.school;
  tenant = await login("referred-school@referral.test");
  const account = await request("/referrals/account", { client: marketer });
  assert.equal(account.data.referrals.length, 1);
  assert.equal(account.data.referrals[0].subscribed, false);
  assert.equal(
    (await request("/referrals/account", { client: tenant })).status,
    403,
  );
});
test("approved first payment earns commission in paid currency, idempotently; renewals and test payments do not", async () => {
  const testPayment = await payment({ mode: "SANDBOX" });
  await settleSubscriptionPayment(db, testPayment.id, null, { testMode: true });
  assert.equal(
    (await request("/referrals/account", { client: marketer })).data.commissions
      .length,
    0,
  );
  const p = await payment();
  const response = await request(`/saas/owner/payments/${p.id}/review`, {
    client: owner,
    method: "POST",
    body: { decision: "APPROVE", note: "Transfer confirmed" },
  });
  assert.equal(response.status, 200, JSON.stringify(response));
  await settleSubscriptionPayment(db, p.id, owner.user.id);
  const account = (await request("/referrals/account", { client: marketer }))
    .data;
  assert.equal(account.commissions.length, 1);
  commission = account.commissions[0];
  assert.equal(Number(commission.amount_cents), 1875000);
  assert.equal(commission.currency, "NGN");
  assert.equal(account.referrals[0].subscribed, true);
  await request("/saas/owner/referrals/settings", {
    client: owner,
    method: "PATCH",
    body: { referral_percent: 25 },
  });
  const renewal = await payment();
  await settleSubscriptionPayment(db, renewal.id, owner.user.id);
  const after = (await request("/referrals/account", { client: marketer })).data
    .commissions;
  assert.equal(after.length, 1);
  assert.equal(Number(after[0].percent), 12.5);
});
test("bank profile and owner-recorded payouts preserve transaction history and prevent duplicate payment marking", async () => {
  const bank = {
    name: "Marketer Updated",
    bank_name: "Example Bank",
    account_name: "Marketer One",
    account_number: "0123456789",
  };
  assert.equal(
    (
      await request("/referrals/account", {
        client: marketer,
        method: "PATCH",
        body: bank,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/saas/owner/referrals/${commission.id}/paid`, {
        client: marketer,
        method: "POST",
        body: { ...bank, payment_reference: "transfer-001" },
      })
    ).status,
    403,
  );
  const { name, ...destination } = bank;
  const paid = await request(`/saas/owner/referrals/${commission.id}/paid`, {
    client: owner,
    method: "POST",
    body: { ...destination, payment_reference: "transfer-001" },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid));
  assert.equal(paid.data.status, "PAID");
  assert.equal(
    (
      await request(`/saas/owner/referrals/${commission.id}/paid`, {
        client: owner,
        method: "POST",
        body: { ...destination, payment_reference: "transfer-001" },
      })
    ).status,
    409,
  );
  await request("/referrals/account", {
    client: marketer,
    method: "PATCH",
    body: { ...bank, account_number: "9999999999" },
  });
  const history = (await request("/referrals/account", { client: marketer }))
    .data.commissions[0];
  assert.equal(history.account_number, "0123456789");
  assert.equal(history.payment_reference, "transfer-001");
});
test("school logos are tenant scoped, visible in portal config and receipts; invalid uploads fail", async () => {
  async function upload(client, buffer = png, name = "school.png") {
    const form = new FormData();
    form.append("logo", new Blob([buffer]), name);
    return fetch(base + "/school/logo", {
      method: "POST",
      headers: { cookie: client.cookie, "x-csrf-token": client.csrf },
      body: form,
    });
  }
  const up = await upload(tenant);
  assert.equal(up.status, 200, await up.text());
  const config = (await request("/config", { client: tenant })).data;
  assert.ok(config.school.logo_data.startsWith("data:image/png;base64,"));
  const portal = (await request("/saas/portal/referred-school")).data;
  assert.equal(portal.logo_data, config.school.logo_data);
  assert.equal((await upload(marketer)).status, 403);
  assert.equal(
    (await upload(tenant, Buffer.from("<svg/>"), "fake.png")).status,
    422,
  );
  assert.equal(
    (await upload(tenant, Buffer.alloc(256 * 1024 + 1))).status,
    422,
  );
  const doc = new PDFDocument();
  const chunks = [];
  doc.on("data", (b) => chunks.push(b));
  const finished = new Promise((r) => doc.on("end", r));
  drawPaymentReceipt(doc, {
    school: config.school,
    payment: {
      amount_cents: 10000,
      receipt_number: "R-1",
      paid_at: new Date(),
      payment_method: "BANK_TRANSFER",
      reference_number: "T-1",
    },
    invoice: { invoice_number: "I-1" },
    student: {
      first_name: "Test",
      last_name: "Student",
      student_number: "S-1",
    },
  });
  doc.end();
  await finished;
  assert.ok(
    Buffer.concat(chunks).toString("latin1").includes("/Subtype /Image"),
  );
  const other = await insert(db, "schools", {
    name: "Another school",
    short_code: "LOGO2",
  });
  assert.equal(
    (await one(db, "SELECT logo_data FROM schools WHERE id=$1", [other.id]))
      .logo_data,
    "",
  );
  const res = await fetch(base + "/school/logo", {
    method: "DELETE",
    headers: { cookie: tenant.cookie, "x-csrf-token": tenant.csrf },
  });
  assert.equal(res.status, 200);
});
test("branded invoice download enforces school and student access", async () => {
  const year = await one(
    db,
    "SELECT id FROM academic_years WHERE school_id=$1",
    [school.id],
  );
  const term = await one(db, "SELECT id FROM terms WHERE school_id=$1", [
    school.id,
  ]);
  const cls = await insert(db, "classes", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Primary 1",
    capacity: 30,
  });
  const student = await insert(db, "students", {
    school_id: school.id,
    first_name: "Ada",
    last_name: "Test",
    gender: "FEMALE",
    date_of_birth: "2017-01-01",
    guardian_name: "Parent",
    guardian_phone: "08012345678",
    class_id: cls.id,
    status: "ENROLLED",
  });
  const invoice = await insert(db, "student_invoices", {
    school_id: school.id,
    student_id: student.id,
    term_id: term.id,
    invoice_number: "INV-REF-1",
    total_cents: 10000,
    due_date: "2026-12-01",
  });
  await insert(db, "invoice_items", {
    school_id: school.id,
    invoice_id: invoice.id,
    description: "Tuition",
    amount_cents: 10000,
  });
  await db.query("UPDATE schools SET logo_data=$2 WHERE id=$1", [
    school.id,
    `data:image/png;base64,${png.toString("base64")}`,
  ]);
  const res = await fetch(base + `/finance/invoices/${invoice.id}/pdf`, {
    headers: { cookie: tenant.cookie },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.ok(
    Buffer.from(await res.arrayBuffer())
      .toString("latin1")
      .includes("/Subtype /Image"),
  );
  const parent = await insert(db, "users", {
    school_id: school.id,
    name: "Unlinked Parent",
    email: "parent@referral.test",
    password_hash: hashPassword(password),
    role: "PARENT",
  });
  const session = await login(parent.email);
  assert.equal(
    (
      await fetch(base + `/finance/invoices/${invoice.id}/pdf`, {
        headers: { cookie: session.cookie },
      })
    ).status,
    404,
  );
  await db.query("UPDATE students SET parent_user_id=$2 WHERE id=$1", [
    student.id,
    parent.id,
  ]);
  assert.equal(
    (
      await fetch(base + `/finance/invoices/${invoice.id}/pdf`, {
        headers: { cookie: session.cookie },
      })
    ).status,
    200,
  );
});
test("closing referral account stops new signups and earnings and retains access to payment history", async () => {
  assert.equal(
    (
      await request("/referrals/account/close", {
        client: marketer,
        method: "POST",
        body: { password: "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/referrals/account/close", {
        client: marketer,
        method: "POST",
        body: { password },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/saas/register", {
        method: "POST",
        body: registration("closed-referrer"),
      })
    ).status,
    422,
  );
  const account = (await request("/referrals/account", { client: marketer }))
    .data;
  assert.ok(account.account.closed_at);
  assert.equal(account.commissions.length, 1);
  assert.equal(account.commissions[0].status, "PAID");
  await initializeSchema(db);
  assert.equal(
    (await request("/referrals/account", { client: marketer })).status,
    200,
  );
});
test("marketer accounts cannot see one another and credential updates require password and re-verification", async () => {
  const result = await request("/referrals/register", {
    method: "POST",
    body: {
      name: "Other Marketer",
      email: "other@referral.test",
      password,
      privacy_accepted: true,
      terms_accepted: true,
      terms_version: MARKETER_TERMS_VERSION,
    },
  });
  assert.equal(result.status, 201);
  const other = await login("other@referral.test");
  const account = (await request("/referrals/account", { client: other })).data;
  assert.equal(account.commissions.length, 0);
  assert.equal(account.referrals.length, 0);
  assert.equal(
    (
      await request("/referrals/account/credentials", {
        client: other,
        method: "PATCH",
        body: { email: "new@referral.test", current_password: "wrong" },
      })
    ).status,
    403,
  );
  const update = await request("/referrals/account/credentials", {
    client: other,
    method: "PATCH",
    body: { email: "new@referral.test", current_password: password },
  });
  assert.equal(update.status, 200, JSON.stringify(update));
  assert.equal(
    (await request("/referrals/account", { client: other })).status,
    401,
  );
  const updated = await login("new@referral.test");
  assert.equal(
    (await request("/referrals/account", { client: updated })).status,
    200,
  );
});

test("signature uploads validate images and support removal", async () => {
  async function upload(buffer) {
    const body = new FormData(); body.append("signature", new Blob([buffer]), "signature.png");
    return fetch(base + "/school/signature", {method:"POST", body, headers:{cookie:tenant.cookie,"x-csrf-token":tenant.csrf}});
  }
  assert.equal((await upload(Buffer.from("invalid"))).status,422);
  assert.equal((await upload(png)).status,200);
  assert.ok((await request("/config",{client:tenant})).data.school.signature_data.startsWith("data:image/png;base64,"));
  const res = await fetch(base + "/school/signature",{method:"DELETE",headers:{cookie:tenant.cookie,"x-csrf-token":tenant.csrf}});
  assert.equal(res.status,200);
  assert.equal((await request("/config",{client:tenant})).data.school.signature_data, "");
});
test("parent messages reject foreign recipients and deduplicate selections", async () => {
  const parent = await insert(db,"users",{school_id:school.id,name:"Message parent",email:"message-parent@referral.test",password_hash:await hashPassword(password),role:"PARENT"});
  const other = await insert(db,"schools",{name:"Message isolation",short_code:"MSGISO"});
  const foreign = await insert(db,"users",{school_id:other.id,name:"Foreign parent",email:"foreign-message@referral.test",password_hash:await hashPassword(password),role:"PARENT"});
  const send = ids => request("/parent-messages",{client:tenant,method:"POST",body:{recipient_ids:ids,title:"School meeting",body:"Please attend on Friday."}});
  assert.equal((await send([parent.id,foreign.id])).status,422);
  assert.equal(String((await one(db,"SELECT count(*) AS n FROM notifications WHERE title='School meeting'")).n),"0");
  const result = await send([parent.id,parent.id]);
  assert.equal(result.status,200); assert.equal(result.data.count,1);
  assert.equal((await request("/parent-messages/recipients",{client:marketer})).status,403);
  const recipients = (await request("/parent-messages/recipients",{client:tenant})).data;
  assert.ok(recipients.some(p => p.id === parent.id));
  assert.ok(!recipients.some(p => p.id === foreign.id));
});
