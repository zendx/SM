import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { initializeSchema } from "../server/schema.js";

test("owner pricing updates new quotes while preserving existing payment amounts", async () => {
  const db = await openTestDatabase(),
    app = await createApp(db);
  const password = "Global-pricing-2026!";
  const ownerUser = await insert(db, "users", {
    school_id: null,
    name: "Owner",
    email: "owner@pricing.test",
    role: "PLATFORM_OWNER",
    password_hash: hashPassword(password),
  });
  await insert(db, "platform_operators", { user_id: ownerUser.id });
  const school = await insert(db, "schools", {
    name: "School",
    short_code: "PRICE",
    portal_slug: "price-school",
  });
  await insert(db, "users", {
    school_id: school.id,
    name: "Admin",
    email: "admin@pricing.test",
    role: "SUPER_ADMIN",
    password_hash: hashPassword(password),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function call(path, session, body, method = body ? "POST" : "GET") {
    const res = await fetch(base + path, {
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
  try {
    const ownerLogin = await call("/auth/owner/login", null, {
      email: ownerUser.email,
      password,
    });
    const owner = { cookie: ownerLogin.cookie, csrf: ownerLogin.data.csrf };
    const adminLogin = await call("/auth/login", null, {
      email: "admin@pricing.test",
      password,
    });
    const admin = { cookie: adminLogin.cookie, csrf: adminLogin.data.csrf };
    const baseSettings = {
      bank_name: "Bank",
      account_name: "SMPIS",
      account_number: "1234567890",
      bank_instructions: "Use the reference",
      grace_days: 0,
      landing_currency: "USD",
      landing_usd_rate: 1,
    };
    assert.equal(
      (await call("/saas/owner/settings", owner, baseSettings, "PATCH")).status,
      200,
    );
    const original = await call("/subscription/bank", admin, {
      billing_cycle: "MONTHLY",
      transfer_reference: "ORIGINAL",
    });
    assert.equal(original.status, 201);
    for (const value of [0, -1, 10.5, 100000001])
      assert.equal(
        (
          await call(
            "/saas/owner/settings",
            owner,
            { ...baseSettings, monthly_price_cents: value },
            "PATCH",
          )
        ).status,
        422,
      );
    assert.equal(
      (
        await call(
          "/saas/owner/settings",
          admin,
          { ...baseSettings, monthly_price_cents: 5500 },
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/saas/owner/settings",
          owner,
          {
            ...baseSettings,
            monthly_price_cents: 5500,
            yearly_price_cents: 55000,
            landing_currency: "NGN",
            landing_usd_rate: 1500,
          },
          "PATCH",
        )
      ).status,
      200,
    );
    const plans = (await call("/saas/plans")).data;
    assert.equal(plans.base_monthly_cents, 5500);
    assert.equal(plans.base_yearly_cents, 55000);
    assert.equal(plans.monthly_cents, 5500 * 1500);
    const fresh = await call("/subscription/bank", admin, {
      billing_cycle: "YEARLY",
      transfer_reference: "UPDATED",
    });
    assert.equal(fresh.status, 201, JSON.stringify(fresh));
    assert.equal(fresh.data.amount_cents, 55000);
    assert.equal(Number(fresh.data.charge_amount_cents), 55000 * 1500);
    assert.equal(
      (
        await one(
          db,
          "SELECT amount_cents FROM subscription_payments WHERE id=$1",
          [original.data.id],
        )
      ).amount_cents,
      10000,
    );
    await initializeSchema(db);
    assert.equal(
      (
        await one(
          db,
          "SELECT monthly_price_cents FROM saas_settings WHERE id=1",
        )
      ).monthly_price_cents,
      5500,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
