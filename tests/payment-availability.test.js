import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";

test("subscription availability and independent school fee collection enforce scope and verified receipts", async () => {
  const db = await openTestDatabase();
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.APP_URL = "https://smpis.test";
  const app = await createApp(db),
    password = "Payment-methods-2026!";
  const ownerUser = await insert(db, "users", {
    school_id: null,
    name: "Owner",
    email: "owner@methods.test",
    role: "PLATFORM_OWNER",
    password_hash: hashPassword(password),
  });
  await insert(db, "platform_operators", { user_id: ownerUser.id });
  const school = await insert(db, "schools", {
    name: "Payment School",
    short_code: "METHOD",
    portal_slug: "methods",
    currency_code: "USD",
  });
  const adminUser = await insert(db, "users", {
    school_id: school.id,
    name: "Admin",
    email: "admin@methods.test",
    role: "SUPER_ADMIN",
    password_hash: hashPassword(password),
  });
  const parentUser = await insert(db, "users", {
    school_id: school.id,
    name: "Parent",
    email: "parent@methods.test",
    role: "PARENT",
    password_hash: hashPassword(password),
  });
  const year = await insert(db, "academic_years", {
    school_id: school.id,
    name: "2026",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  });
  const term = await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Term",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    is_current: true,
  });
  const student = await insert(db, "students", {
    school_id: school.id,
    first_name: "Student",
    last_name: "One",
    gender: "OTHER",
    date_of_birth: "2015-01-01",
    guardian_name: "Parent",
    guardian_phone: "+2348012345678",
    parent_user_id: parentUser.id,
  });
  const invoice = await insert(db, "student_invoices", {
    school_id: school.id,
    student_id: student.id,
    term_id: term.id,
    invoice_number: "METHOD-1",
    total_cents: 100000,
    due_date: "2026-12-31",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const original = globalThis.fetch;
  let remote = {},
    badAmount = false;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.startsWith(base)) return original(url, options);
    if (address.endsWith("/capture")) {
      remote.paypal.status = "COMPLETED";
      return new Response(JSON.stringify(remote.paypal));
    }
    if (address.includes("oauth2/token"))
      return new Response(JSON.stringify({ access_token: "test-access" }));
    if (options?.body) {
      if (address.includes("stripe")) {
        remote.stripe = {
          id: "cs_test_school",
          client_reference_id: options.body.get("client_reference_id"),
          currency: "usd",
          amount_total: 1000,
          livemode: options.headers.Authorization.includes("sk_live_"),
          payment_status: "paid",
        };
        return new Response(
          JSON.stringify({
            id: remote.stripe.id,
            url: "https://checkout.stripe.com/test",
          }),
        );
      }
      if (address.endsWith("/payments")) {
        const b = JSON.parse(options.body);
        remote.flutterwave = {
          tx_ref: b.tx_ref,
          amount: 10,
          currency: "USD",
          status: "successful",
        };
        return new Response(
          JSON.stringify({
            status: "success",
            data: { link: "https://checkout.flutterwave.com/test" },
          }),
        );
      }
      if (address.endsWith("/orders")) {
        const b = JSON.parse(options.body);
        remote.paypal = {
          id: "ORDER-SCHOOL",
          status: "APPROVED",
          purchase_units: [
            {
              ...b.purchase_units[0],
              payments: {
                captures: [
                  {
                    status: "COMPLETED",
                    amount: { value: "10.00", currency_code: "USD" },
                  },
                ],
              },
            },
          ],
        };
        return new Response(
          JSON.stringify({
            id: "ORDER-SCHOOL",
            links: [{ rel: "approve", href: "https://paypal.com/checkout" }],
          }),
        );
      }
    }
    return new Response(
      JSON.stringify(
        address.includes("stripe")
          ? { ...remote.stripe, amount_total: badAmount ? 1 : 1000 }
          : address.includes("flutterwave")
            ? { status: "success", data: remote.flutterwave }
            : remote.paypal,
      ),
    );
  };
  async function call(path, session, body, method = body ? "POST" : "GET") {
    const res = await original(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      ...(await res.json()),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(user, owner = false) {
    const r = await call(owner ? "/auth/owner/login" : "/auth/login", null, {
      email: user.email,
      password,
    });
    assert.equal(r.status, 200);
    return { ...r.data, cookie: r.cookie };
  }
  try {
    const owner = await login(ownerUser, true),
      admin = await login(adminUser),
      parent = await login(parentUser);
    const otherSchool = await insert(db, "schools", {
      name: "Other School",
      short_code: "OTHER",
      portal_slug: "other-payment-school",
    });
    const otherUser = await insert(db, "users", {
      school_id: otherSchool.id,
      name: "Other Admin",
      email: "other@methods.test",
      role: "SUPER_ADMIN",
      password_hash: hashPassword(password),
    });
    const other = await login(otherUser);
    const settings = {
      bank_name: "Owner Bank",
      account_name: "SMPIS",
      account_number: "123",
      bank_instructions: "Transfer",
      grace_days: 0,
      bank_enabled: false,
    };
    assert.equal(
      (await call("/saas/owner/settings", owner, settings, "PATCH")).status,
      200,
    );
    assert.deepEqual((await call("/subscription", admin)).data.providers, {});
    assert.equal(
      (await call("/subscription", admin)).data.settings.account_number,
      "",
    );
    assert.equal(
      (
        await call("/subscription/bank", admin, {
          billing_cycle: "MONTHLY",
          transfer_reference: "NO",
        })
      ).status,
      503,
    );
    const gateway = {
      enabled: true,
      mode: "SANDBOX",
      secret_key: "sk_test_available",
      webhook_secret: "webhook",
    };
    assert.equal(
      (await call("/saas/owner/providers/stripe", owner, gateway, "PATCH"))
        .status,
      200,
    );
    assert.deepEqual((await call("/subscription", admin)).data.providers, {});
    assert.equal(
      (
        await call("/subscription/checkout", admin, {
          billing_cycle: "MONTHLY",
          provider: "stripe",
        })
      ).status,
      503,
    );
    await call(
      "/saas/owner/providers/stripe",
      owner,
      { ...gateway, mode: "LIVE", secret_key: "sk_live_available" },
      "PATCH",
    );
    assert.deepEqual(
      Object.keys((await call("/subscription", admin)).data.providers),
      ["stripe"],
    );
    await call(
      "/saas/owner/settings",
      owner,
      { ...settings, bank_enabled: true },
      "PATCH",
    );
    assert.equal(
      (
        await call("/subscription/bank", admin, {
          billing_cycle: "MONTHLY",
          transfer_reference: "YES",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call("/payments/school/checkout", parent, {
          provider: "manual",
          invoice_id: invoice.id,
          amount: "10",
          transfer_reference: "REF",
        })
      ).status,
      503,
    );
    const manual = {
      enabled: true,
      bank_name: "School Bank",
      account_name: "School",
      account_number: "999",
      instructions: "Use invoice number",
    };
    assert.equal(
      (await call("/admin/integrations/manual", parent, manual, "PATCH"))
        .status,
      403,
    );
    assert.equal(
      (await call("/admin/integrations/manual", admin, manual, "PATCH")).status,
      200,
    );
    assert.equal(
      (await call("/payments/school/methods", parent)).data.manual
        .account_number,
      "999",
    );
    const m = (
      await call("/payments/school/checkout", parent, {
        provider: "manual",
        invoice_id: invoice.id,
        amount: "10",
        transfer_reference: "REF",
      })
    ).data;
    assert.equal(
      (
        await call("/payments/school/verify", other, {
          reference: m.reference,
          confirm_manual: true,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("/payments/school/checkout", other, {
          provider: "manual",
          invoice_id: invoice.id,
          amount: "10",
          transfer_reference: "FOREIGN",
        })
      ).status,
      404,
    );
    assert.deepEqual((await call("/payments/school/methods", other)).data, {});
    assert.equal(
      (
        await call("/payments/school/verify", parent, {
          reference: m.reference,
          confirm_manual: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/payments/school/verify", admin, {
          reference: m.reference,
          confirm_manual: true,
        })
      ).data.status,
      "PAID",
    );
    assert.equal(
      (
        await call("/payments/school/verify", admin, {
          reference: m.reference,
          confirm_manual: true,
        })
      ).data.status,
      "PAID",
    );
    for (const provider of ["stripe", "paypal", "flutterwave"]) {
      const body =
        provider === "stripe"
          ? { enabled: true, secret_key: "sk_test_school" }
          : provider === "paypal"
            ? { enabled: true, client_id: "client", client_secret: "secret" }
            : {
                enabled: true,
                public_key: "public",
                secret_key: "FLWSECK-school_TEST",
              };
      assert.equal(
        (await call(`/admin/integrations/${provider}`, admin, body, "PATCH"))
          .status,
        200,
      );
      const checkout = await call("/payments/school/checkout", parent, {
        provider,
        invoice_id: invoice.id,
        amount: "10",
      });
      assert.equal(checkout.status, 201, JSON.stringify(checkout));
      if (provider === "stripe") {
        badAmount = true;
        assert.equal(
          (
            await call("/payments/school/verify", parent, {
              reference: checkout.data.reference,
            })
          ).status,
          422,
        );
        badAmount = false;
      }
      assert.equal(
        (
          await call("/payments/school/verify", parent, {
            reference: checkout.data.reference,
          })
        ).data.status,
        "TEST_CONFIRMED",
      );
    }
    for (const provider of ["stripe", "paypal", "flutterwave"]) {
      const settings =
        provider === "stripe"
          ? { enabled: true, live_enabled: true, secret_key: "sk_live_school" }
          : provider === "paypal"
            ? {
                enabled: true,
                live_enabled: true,
                client_id: "client",
                client_secret: "secret",
              }
            : {
                enabled: true,
                live_enabled: true,
                public_key: "public",
                secret_key: "FLWSECK-school",
              };
      assert.equal(
        (
          await call(
            `/admin/integrations/${provider}`,
            admin,
            settings,
            "PATCH",
          )
        ).status,
        200,
      );
      const payment = await call("/payments/school/checkout", parent, {
        provider,
        invoice_id: invoice.id,
        amount: "10",
      });
      assert.equal(payment.status, 201);
      const verified = await call("/payments/school/verify", parent, {
        reference: payment.data.reference,
      });
      assert.equal(verified.status, 200, JSON.stringify(verified));
      assert.equal(verified.data.status, "PAID");
      assert.equal(
        (
          await call("/payments/school/verify", parent, {
            reference: payment.data.reference,
          })
        ).data.status,
        "PAID",
      );
    }
    assert.equal(
      Number(
        (
          await one(db, "SELECT paid_cents FROM student_invoices WHERE id=$1", [
            invoice.id,
          ])
        ).paid_cents,
      ),
      4000,
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM payments WHERE invoice_id=$1",
          [invoice.id],
        )
      ).n,
      4,
    );
  } finally {
    globalThis.fetch = original;
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
